import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { SupplierPayment } from './entities/supplier-payment.entity.js';
import { SupplierPaymentsController } from './supplier-payments.controller.js';
import { SupplierPaymentsService } from './supplier-payments.service.js';

import { Purchase } from '../purchases/entities/purchase.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupplierPayment, Purchase]),

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

  controllers: [SupplierPaymentsController],

  providers: [SupplierPaymentsService],

  exports: [SupplierPaymentsService],
})
export class SupplierPaymentsModule {}
