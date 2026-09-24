import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Supplier } from '../suppliers/entities/supplier.entity.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { Payment } from '../payments/entities/payments.entity.js';
import { Purchase } from '../purchases/entities/purchase.entity.js';
import { Expense } from '../expenses/entities/expense.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { SupplierPayment } from '../supplier-payments/entities/supplier-payment.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      Payment,
      Purchase,
      Expense,
      Product,
      SupplierPayment,
      Customer,
      Supplier,
    ]),

    ConfigModule,

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '1d',
        },
      }),
    }),
  ],

  controllers: [ReportsController],

  providers: [ReportsService],
})
export class ReportsModule {}
