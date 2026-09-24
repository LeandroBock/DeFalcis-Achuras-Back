import { Injectable, NotFoundException } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { In } from 'typeorm';
import {
  Purchase,
  PurchasePaymentStatus,
  PurchasePaymentMethod,
} from './entities/purchase.entity.js';
import { PurchaseItem } from '../purchase-items/entities/purchase-item.entity.js';

import { Supplier } from '../suppliers/entities/supplier.entity.js';
import { Product } from '../products/entities/product.entity.js';

import { CreatePurchaseDto } from './dto/create-purchase.dto.js';
import { InventoryService } from '../inventory/inventory.service.js';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectRepository(Purchase)
    private readonly purchasesRepository: Repository<Purchase>,

    @InjectRepository(PurchaseItem)
    private readonly purchaseItemsRepository: Repository<PurchaseItem>,

    @InjectRepository(Supplier)
    private readonly suppliersRepository: Repository<Supplier>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  async create(createPurchaseDto: CreatePurchaseDto) {
    const { supplierId, paymentMethod, notes, items } = createPurchaseDto;

    return this.dataSource.transaction(async (manager) => {
      const supplierRepository = manager.getRepository(Supplier);

      const productRepository = manager.getRepository(Product);

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
      for (const item of items) {
        const product = await productRepository.findOne({
          where: {
            id: item.productId,
            isActive: true,
          },
        });

        if (!product) {
          throw new NotFoundException(
            `El producto ${item.productId} no existe o está inactivo`,
          );
        }

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

      // 4. Asociar los items
      for (const item of purchaseItems) {
        item.purchaseId = savedPurchase.id;
      }

      await purchaseItemRepository.save(purchaseItems);

      // 5. Actualizar stock y registrar movimientos
      for (const item of purchaseItems) {
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

  async findAll() {
    return this.purchasesRepository.find({
      where: {
        // 👇 Filtramos para traer solo las PENDING y PAID (ocultando las CANCELLED)
        // TypeORM permite pasar un array de condiciones (funcionan como un OR)
        paymentStatus: In([
          PurchasePaymentStatus.PENDING,
          PurchasePaymentStatus.PAID,
        ]),
      } as any,
      order: {
        createdAt: 'DESC',
      },
    });
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

  // 👇 Agrega este método al final de tu servicio para el borrado lógico
  async remove(id: string) {
    // 1. Buscamos la compra y sus ítems usando el método que ya tienes programado
    const { purchase, items } = await this.findOne(id);

    // Evitamos duplicar la anulación si la compra ya fue desactivada/anulada antes
    if (purchase.paymentStatus === PurchasePaymentStatus.CANCELLED) {
      throw new NotFoundException('La compra ya se encuentra anulada');
    }

    return this.dataSource.transaction(async (manager) => {
      const purchaseRepository = manager.getRepository(Purchase);

      // 2. Revertir el stock restando las cantidades en el inventario
      for (const item of items) {
        await this.inventoryService.registerPurchaseEntry(
          item.productId,
          -Number(item.quantity), // 👈 Enviamos la cantidad en negativo para restar del stock
          purchase.id,
          manager,
        );
      }

      // 3. Aplicar Borrado Lógico en la entidad Purchase
      // Modifica la propiedad según los campos exactos de tu tabla (ej. isActive = false)
      purchase.paymentStatus = PurchasePaymentStatus.CANCELLED; // O agrega un nuevo enum si manejas CANCELLED

      const updatedPurchase = await purchaseRepository.save(purchase);

      return {
        message: 'Compra anulada correctamente y stock revertido',
        purchase: updatedPurchase,
      };
    });
  }
}
