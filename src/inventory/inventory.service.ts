import { Injectable, NotFoundException } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';

import {
  InventoryMovement,
  InventoryMovementType,
} from './entities/inventory-movement.entity.js';

import { Product } from '../products/entities/product.entity.js';

import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto.js';
import {
  PaginationQueryDto,
  findMaybePaginated,
} from '../common/pagination.js';

type StockChange = {
  productId: string;
  // Diferencia a aplicar, o valor absoluto si type es ADJUSTMENT.
  quantity: number;
  type: InventoryMovementType;
  reason?: string;
  referenceId?: string;
};

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryMovement)
    private readonly movementsRepository: Repository<InventoryMovement>,

    private readonly dataSource: DataSource,
  ) {}

  async create(createInventoryMovementDto: CreateInventoryMovementDto) {
    const { productId, type, quantity, reason } = createInventoryMovementDto;

    return this.dataSource.transaction(async (manager) => {
      const { product, movement } = await this.applyStockChange(manager, {
        productId,
        type,
        quantity,
        reason,
      });

      return {
        movement,
        stock: product.stock,
      };
    });
  }

  async findAll(query: PaginationQueryDto) {
    return findMaybePaginated(
      this.movementsRepository,
      { order: { createdAt: 'DESC', id: 'DESC' } },
      query,
    );
  }

  // Una cantidad negativa revierte una compra (anulación o edición).
  async registerPurchaseEntry(
    productId: string,
    quantity: number,
    purchaseId: string,
    manager?: EntityManager,
  ) {
    return this.inTransaction(manager, async (txManager) => {
      const { movement } = await this.applyStockChange(txManager, {
        productId,
        type:
          quantity >= 0
            ? InventoryMovementType.ENTRY
            : InventoryMovementType.EXIT,
        quantity: Math.abs(quantity),
        reason: quantity >= 0 ? 'Ingreso por compra' : 'Reversión de compra',
        referenceId: purchaseId,
      });

      return movement;
    });
  }

  async registerSaleExit(
    productId: string,
    quantity: number,
    orderId: string,
    manager?: EntityManager,
  ) {
    return this.inTransaction(manager, async (txManager) => {
      const { movement } = await this.applyStockChange(txManager, {
        productId,
        type: InventoryMovementType.EXIT,
        quantity,
        reason: 'Salida por venta',
        referenceId: orderId,
      });

      return movement;
    });
  }

  private inTransaction<T>(
    manager: EntityManager | undefined,
    work: (manager: EntityManager) => Promise<T>,
  ) {
    return manager ? work(manager) : this.dataSource.transaction(work);
  }

  // Bloquea la fila del producto (SELECT ... FOR UPDATE) hasta el fin de la
  // transacción, para que dos operaciones simultáneas no se pisen el stock.
  private async applyStockChange(manager: EntityManager, change: StockChange) {
    const productRepository = manager.getRepository(Product);
    const movementRepository = manager.getRepository(InventoryMovement);

    const product = await productRepository.findOne({
      where: {
        id: change.productId,
        isActive: true,
      },
      lock: { mode: 'pessimistic_write' },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado o inactivo');
    }

    const currentStock = Number(product.stock);

    let newStock = currentStock;

    if (change.type === InventoryMovementType.ENTRY) {
      newStock = currentStock + change.quantity;
    }

    if (change.type === InventoryMovementType.EXIT) {
      // Se permite stock negativo.
      newStock = currentStock - change.quantity;
    }

    if (change.type === InventoryMovementType.ADJUSTMENT) {
      newStock = change.quantity;
    }

    product.stock = Number(newStock.toFixed(3));

    await productRepository.update(product.id, { stock: product.stock });

    const movement = await movementRepository.save(
      movementRepository.create({
        productId: change.productId,
        type: change.type,
        quantity: change.quantity,
        reason: change.reason,
        referenceId: change.referenceId,
      }),
    );

    return { product, movement };
  }
}
