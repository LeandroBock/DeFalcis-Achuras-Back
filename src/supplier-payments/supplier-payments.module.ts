import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { SupplierPayment } from './entities/supplier-payment.entity.js';
import { SupplierPaymentsController } from './supplier-payments.controller.js';
import { SupplierPaymentsService } from './supplier-payments.service.js';

import { Purchase } from '../purchases/entities/purchase.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupplierPayment, Purchase]),

    ConfigModule,
  ],

  controllers: [SupplierPaymentsController],

  providers: [SupplierPaymentsService],

  exports: [SupplierPaymentsService],
})
export class SupplierPaymentsModule {}
