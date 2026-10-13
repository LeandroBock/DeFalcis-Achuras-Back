import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Not } from 'typeorm';
import {
  Purchase,
  PurchasePaymentStatus,
  PurchasePaymentMethod,
} from './entities/purchase.entity.js';
import { PurchaseItem } from '../purchase-items/entities/purchase-item.entity.js';

import { Supplier } from '../suppliers/entities/supplier.entity.js';
import { UpdatePurchaseDto } from './dto/update-purchase.dto.js';
import { CreatePurchaseDto } from './dto/create-purchase.dto.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { findActiveProductsById } from '../products/active-products.js';
import {
  SupplierPayment,
  SupplierPaymentMethod,
} from '../supplier-payments/entities/supplier-payment.entity.js';
import {
  getPurchasePaidAmount,
  moveExcessToSupplierCredit,
  resolvePurchasePaymentStatus,
} from '../supplier-payments/purchase-balance.js';
import {
  PaginationQueryDto,
  findMaybePaginated,
} from '../common/pagination.js';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectRepository(Purchase)
    private readonly purchasesRepository: Repository<Purchase>,

    @InjectRepository(PurchaseItem)
    private readonly purchaseItemsRepository: Repository<PurchaseItem>,

    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  async create(createPurchaseDto: CreatePurchaseDto) {
    const { supplierId, paymentMethod, notes, items } = createPurchaseDto;

    return this.dataSource.transaction(async (manager) => {
      const supplierRepository = manager.getRepository(Supplier);

      const purchaseRepository = manager.getRepository(Purchase);

      const purchaseItemRepository = manager.getRepository(PurchaseItem);

      // 1. Verificar proveedor
      const supplier = await supplierRepository.findOne({
        where: {
          id: supplierId,
          isActive: true,
        },
      });

      if (!supplier) {
        throw new NotFoundException('El proveedor no existe o está inactivo');
      }

      let total = 0;

      const purchaseItems: PurchaseItem[] = [];

      // 2. Verificar productos y calcular subtotales
      await findActiveProductsById(
        manager,
        items.map((item) => item.productId),
      );

      for (const item of items) {
        const subtotal = Number((item.quantity * item.unitCost).toFixed(2));

        total += subtotal;

        const purchaseItem = purchaseItemRepository.create({
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          subtotal,
        });

        purchaseItems.push(purchaseItem);
      }

      // 3. Crear compra
      const initialPaymentStatus =
        paymentMethod === PurchasePaymentMethod.CREDIT
          ? PurchasePaymentStatus.PENDING
          : PurchasePaymentStatus.PAID;

      const purchase = purchaseRepository.create({
        supplierId,
        paymentMethod,
        paymentStatus: initialPaymentStatus,
        total,
        notes,
      });

      const savedPurchase = await purchaseRepository.save(purchase);

      // Las compras de contado quedan pagadas al registrarse: se guarda el
      // pago para que lo pagado sea siempre la suma de los pagos.
      if (paymentMethod !== PurchasePaymentMethod.CREDIT && total > 0) {
        const paymentRepository = manager.getRepository(SupplierPayment);

        await paymentRepository.save(
          paymentRepository.create({
            purchaseId: savedPurchase.id,
            amount: Number(total.toFixed(2)),
            method: paymentMethod as unknown as SupplierPaymentMethod,
            notes: 'Pago al registrar la compra',
          }),
        );
      }

      // 4. Asociar los items
      for (const item of purchaseItems) {
        item.purchaseId = savedPurchase.id;
      }

      await purchaseItemRepository.save(purchaseItems);

      // 5. Actualizar stock y registrar movimientos (en orden fijo de
      // producto para evitar deadlocks entre operaciones simultáneas)
      const itemsByProduct = [...purchaseItems].sort((a, b) =>
        a.productId.localeCompare(b.productId),
      );

      for (const item of itemsByProduct) {
        await this.inventoryService.registerPurchaseEntry(
          item.productId,
          Number(item.quantity),
          savedPurchase.id,
          manager,
        );
      }

      // 6. Si todo salió bien, COMMIT automático
      return {
        purchase: savedPurchase,
        items: purchaseItems,
      };
    });
  }

  // Todas las compras salvo las anuladas (pendientes, parciales y pagadas).
  async findAll(query: PaginationQueryDto) {
    return findMaybePaginated(
      this.purchasesRepository,
      {
        where: { paymentStatus: Not(PurchasePaymentStatus.CANCELLED) },
        order: { createdAt: 'DESC', id: 'DESC' },
      },
      query,
    );
  }

  async findOne(id: string) {
    const purchase = await this.purchasesRepository.findOne({
      where: { id },
    });

    if (!purchase) {
      throw new NotFoundException('Compra no encontrada');
    }

    const items = await this.purchaseItemsRepository.find({
      where: {
        purchaseId: id,
      },
    });

    return {
      purchase,
      items,
    };
  }

  // Borrado lógico: marca la compra como anulada y revierte el stock.
  async remove(id: string) {
    return this.dataSource.transaction(async (manager) => {
      const purchaseRepository = manager.getRepository(Purchase);
      const purchaseItemRepository = manager.getRepository(PurchaseItem);

      // Se bloquea la compra y se valida su estado dentro de la transacción:
      // dos anulaciones simultáneas no pueden revertir el stock dos veces.
      const purchase = await purchaseRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!purchase) {
        throw new NotFoundException('Compra no encontrada');
      }

      if (purchase.paymentStatus === PurchasePaymentStatus.CANCELLED) {
        throw new ConflictException('La compra ya se encuentra anulada');
      }

      const items = await purchaseItemRepository.find({
        where: { purchaseId: id },
        order: { productId: 'ASC' },
      });

      for (const item of items) {
        await this.inventoryService.registerPurchaseEntry(
          item.productId,
          -Number(item.quantity),
          purchase.id,
          manager,
        );
      }

      // Todo lo que se le pagó al proveedor por esta compra pasa a saldo a
      // favor, utilizable para pagar otras compras.
      const paid = await getPurchasePaidAmount(manager, purchase.id);

      await moveExcessToSupplierCredit(
        manager,
        purchase,
        paid,
        0,
        'Saldo a favor por anulación de compra',
      );

      purchase.paymentStatus = PurchasePaymentStatus.CANCELLED;

      const updatedPurchase = await purchaseRepository.save(purchase);

      return {
        message: 'Compra anulada correctamente y stock revertido',
        purchase: updatedPurchase,
        creditGenerated: Math.max(paid, 0),
      };
    });
  }

  async update(id: string, updatePurchaseDto: UpdatePurchaseDto) {
    return this.dataSource.transaction(async (manager) => {
      const purchaseRepository = manager.getRepository(Purchase);
      const purchaseItemRepository = manager.getRepository(PurchaseItem);
      const supplierRepository = manager.getRepository(Supplier);

      const purchase = await purchaseRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!purchase) {
        throw new NotFoundException('Compra no encontrada');
      }

      if (purchase.paymentStatus === PurchasePaymentStatus.CANCELLED) {
        throw new ConflictException('No se puede modificar una compra anulada');
      }

      const { supplierId, paymentMethod, notes, items } = updatePurchaseDto;

      // Validar proveedor si se está modificando.
      if (supplierId !== undefined) {
        const supplier = await supplierRepository.findOne({
          where: { id: supplierId, isActive: true },
        });

        if (!supplier) {
          throw new NotFoundException('El proveedor no existe o está inactivo');
        }

        purchase.supplierId = supplierId;
      }

      if (paymentMethod !== undefined) {
        purchase.paymentMethod = paymentMethod;
      }

      if (notes !== undefined) {
        purchase.notes = notes;
      }

      // Si no mandaron items, se conservan los existentes.
      if (items !== undefined) {
        const oldItems = await purchaseItemRepository.find({
          where: { purchaseId: id },
        });

        // Agrupar cantidades por producto para contemplar
        // productos repetidos en los ítems.
        const oldQuantities = new Map<string, number>();
        const newQuantities = new Map<string, number>();

        for (const item of oldItems) {
          oldQuantities.set(
            item.productId,
            (oldQuantities.get(item.productId) ?? 0) + Number(item.quantity),
          );
        }

        const newPurchaseItems: PurchaseItem[] = [];
        let total = 0;

        await findActiveProductsById(
          manager,
          items.map((item) => item.productId),
        );

        for (const item of items) {
          const quantity = Number(item.quantity);
          const unitCost = Number(item.unitCost);
          const subtotal = Number((quantity * unitCost).toFixed(2));

          total += subtotal;

          newQuantities.set(
            item.productId,
            (newQuantities.get(item.productId) ?? 0) + quantity,
          );

          newPurchaseItems.push(
            purchaseItemRepository.create({
              purchaseId: id,
              productId: item.productId,
              quantity,
              unitCost,
              subtotal,
            }),
          );
        }

        // Aplicar únicamente la diferencia de stock por producto.
        // Orden fijo de producto para evitar deadlocks.
        const productIds = [
          ...new Set([...oldQuantities.keys(), ...newQuantities.keys()]),
        ].sort();

        for (const productId of productIds) {
          const oldQuantity = oldQuantities.get(productId) ?? 0;
          const newQuantity = newQuantities.get(productId) ?? 0;
          const difference = Number((newQuantity - oldQuantity).toFixed(3));

          if (difference !== 0) {
            await this.inventoryService.registerPurchaseEntry(
              productId,
              difference,
              id,
              manager,
            );
          }
        }

        // Reemplazar los ítems y recalcular el total.
        await purchaseItemRepository.delete({ purchaseId: id });

        purchase.total = Number(total.toFixed(2));

        await purchaseItemRepository.save(newPurchaseItems);
      }

      // Recalcular el estado de pago con el nuevo total. Si lo pagado supera
      // el total (por ejemplo, se corrigieron kilos a la baja), el excedente
      // pasa a saldo a favor del proveedor.
      const total = Number(purchase.total);

      const paid = await moveExcessToSupplierCredit(
        manager,
        purchase,
        await getPurchasePaidAmount(manager, purchase.id),
        total,
        'Saldo a favor por modificación de compra',
      );

      purchase.paymentStatus = resolvePurchasePaymentStatus(total, paid);

      const updatedPurchase = await purchaseRepository.save(purchase);

      const updatedItems = await purchaseItemRepository.find({
        where: { purchaseId: id },
      });

      return {
        purchase: updatedPurchase,
        items: updatedItems,
      };
    });
  }
}
