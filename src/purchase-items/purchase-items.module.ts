import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PurchaseItem } from './entities/purchase-item.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([PurchaseItem])],
  providers: [],
  exports: [],
})
export class PurchaseItemsModule {}
