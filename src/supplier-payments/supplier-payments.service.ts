import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { SupplierPayment } from './entities/supplier-payment.entity.js';

import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto.js';

import {
  Purchase,
  PurchasePaymentStatus,
} from '../purchases/entities/purchase.entity.js';

@Injectable()
export class SupplierPaymentsService {
  constructor(
    @InjectRepository(SupplierPayment)
    private readonly supplierPaymentsRepository: Repository<SupplierPayment>,

    @InjectRepository(Purchase)
    private readonly purchasesRepository: Repository<Purchase>,

    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateSupplierPaymentDto) {
    return this.dataSource.transaction(async (manager) => {
      const purchaseRepository = manager.getRepository(Purchase);

      const paymentRepository = manager.getRepository(SupplierPayment);

      const purchase = await purchaseRepository.findOne({
        where: {
          id: dto.purchaseId,
        },
      });

      if (!purchase) {
        throw new NotFoundException('Compra no encontrada');
      }

      const payments = await paymentRepository.find({
        where: {
          purchaseId: dto.purchaseId,
        },
      });

      const totalPaid = payments.reduce(
        (sum, payment) => sum + Number(payment.amount),
        0,
      );

      const purchaseTotal = Number(Number(purchase.total).toFixed(2));

      const currentPaid = Number(totalPaid.toFixed(2));

      const pendingAmount = Number((purchaseTotal - currentPaid).toFixed(2));

      if (dto.amount > pendingAmount) {
        throw new BadRequestException(
          `El pago supera la deuda pendiente. Saldo pendiente: ${pendingAmount.toFixed(2)}`,
        );
      }

      const payment = paymentRepository.create(dto);

      const savedPayment = await paymentRepository.save(payment);

      const newTotalPaid = Number((currentPaid + dto.amount).toFixed(2));

      if (newTotalPaid === 0) {
        purchase.paymentStatus = PurchasePaymentStatus.PENDING;
      } else if (newTotalPaid < purchaseTotal) {
        purchase.paymentStatus = PurchasePaymentStatus.PARTIAL;
      } else {
        purchase.paymentStatus = PurchasePaymentStatus.PAID;
      }

      await purchaseRepository.save(purchase);

      return {
        payment: savedPayment,
        paymentStatus: purchase.paymentStatus,
        paidAmount: newTotalPaid,
        pendingAmount: Number((purchaseTotal - newTotalPaid).toFixed(2)),
      };
    });
  }

  async findByPurchase(purchaseId: string) {
    const purchase = await this.purchasesRepository.findOne({
      where: {
        id: purchaseId,
      },
    });

    if (!purchase) {
      throw new NotFoundException('Compra no encontrada');
    }

    const payments = await this.supplierPaymentsRepository.find({
      where: {
        purchaseId,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    const paidAmount = payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    const total = Number(purchase.total);

    return {
      purchaseId,
      total,
      paidAmount: Number(paidAmount.toFixed(2)),
      pendingAmount: Number((total - paidAmount).toFixed(2)),
      paymentStatus: purchase.paymentStatus,
      payments,
    };
  }
}
