import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

import { InventoryMovement } from './entities/inventory-movement.entity.js';
import { Product } from '../products/entities/product.entity.js';

import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryMovement, Product]), AuthModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
