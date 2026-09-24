import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from './purchases.service.js';
import { Purchase } from './entities/purchase.entity.js';

import { PurchaseItem } from '../purchase-items/entities/purchase-item.entity.js';

import { AuthModule } from '../auth/auth.module.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { ProductsModule } from '../products/products.module.js';
import { Supplier } from '../suppliers/entities/supplier.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { InventoryModule } from '../inventory/inventory.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Purchase, PurchaseItem, Supplier, Product]),
    AuthModule,
    SuppliersModule,
    ProductsModule,
    InventoryModule,
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
