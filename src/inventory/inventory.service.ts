import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  InventoryMovement,
  InventoryMovementType,
} from './entities/inventory-movement.entity.js';

import { Product } from '../products/entities/product.entity.js';

import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto.js';
import { EntityManager } from 'typeorm';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryMovement)
    private readonly movementsRepository: Repository<InventoryMovement>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {}

  async create(createInventoryMovementDto: CreateInventoryMovementDto) {
    const { productId, type, quantity, reason } = createInventoryMovementDto;

    const product = await this.productsRepository.findOne({
      where: {
        id: productId,
        isActive: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado o inactivo');
    }

    const currentStock = Number(product.stock);

    let newStock = currentStock;

    if (type === InventoryMovementType.ENTRY) {
      newStock = currentStock + quantity;
    }

    if (type === InventoryMovementType.EXIT) {
      if (quantity > currentStock) {
        throw new BadRequestException('No hay suficiente stock disponible');
      }

      newStock = currentStock - quantity;
    }

    if (type === InventoryMovementType.ADJUSTMENT) {
      newStock = quantity;
    }

    product.stock = Number(newStock.toFixed(3));

    await this.productsRepository.save(product);

    const movement = this.movementsRepository.create({
      productId,
      type,
      quantity,
      reason,
    });

    const savedMovement = await this.movementsRepository.save(movement);

    return {
      movement: savedMovement,
      stock: product.stock,
    };
  }

  async findAll() {
    return this.movementsRepository.find({
      order: {
        createdAt: 'DESC',
      },
    });
  }
  async registerPurchaseEntry(
    productId: string,
    quantity: number,
    purchaseId: string,
    manager?: EntityManager,
  ) {
    const productRepository = manager
      ? manager.getRepository(Product)
      : this.productsRepository;

    const movementRepository = manager
      ? manager.getRepository(InventoryMovement)
      : this.movementsRepository;

    const product = await productRepository.findOne({
      where: {
        id: productId,
        isActive: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado o inactivo');
    }

    const currentStock = Number(product.stock);

    const newStock = Number((currentStock + quantity).toFixed(3));

    product.stock = newStock;

    await productRepository.save(product);

    const movement = movementRepository.create({
      productId,
      type: InventoryMovementType.ENTRY,
      quantity,
      reason: 'Ingreso por compra',
      referenceId: purchaseId,
    });

    return movementRepository.save(movement);
  }

  async registerSaleExit(
    productId: string,
    quantity: number,
    orderId: string,
    manager?: EntityManager,
  ) {
    const productRepository = manager
      ? manager.getRepository(Product)
      : this.productsRepository;

    const movementRepository = manager
      ? manager.getRepository(InventoryMovement)
      : this.movementsRepository;

    const product = await productRepository.findOne({
      where: {
        id: productId,
        isActive: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado o inactivo');
    }

    const currentStock = Number(product.stock);

    if (quantity > currentStock) {
      throw new BadRequestException('No hay suficiente stock disponible');
    }

    const newStock = Number((currentStock - quantity).toFixed(3));

    product.stock = newStock;

    await productRepository.save(product);

    const movement = movementRepository.create({
      productId,
      type: InventoryMovementType.EXIT,
      quantity,
      reason: 'Salida por venta',
      referenceId: orderId,
    });

    return movementRepository.save(movement);
  }
}
