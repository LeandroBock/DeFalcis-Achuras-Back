import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto.js';

import {
  Purchase,
  PurchasePaymentStatus,
} from '../purchases/entities/purchase.entity.js';

import { Supplier } from '../suppliers/entities/supplier.entity.js';

import {
  SupplierPayment,
  SupplierPaymentMethod,
} from './entities/supplier-payment.entity.js';

import {
  getPurchasePaidAmount,
  getSupplierCreditBalance,
  resolvePurchasePaymentStatus,
} from './purchase-balance.js';

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

      // Bloquea la compra hasta el fin de la transacción: dos pagos
      // simultáneos no pueden superar la deuda pendiente.
      const purchase = await purchaseRepository.findOne({
        where: {
          id: dto.purchaseId,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!purchase) {
        throw new NotFoundException('Compra no encontrada');
      }

      if (purchase.paymentStatus === PurchasePaymentStatus.CANCELLED) {
        throw new BadRequestException(
          'No se puede registrar un pago para una compra anulada',
        );
      }

      const currentPaid = await getPurchasePaidAmount(manager, purchase.id);

      const purchaseTotal = Number(Number(purchase.total).toFixed(2));

      const pendingAmount = Number((purchaseTotal - currentPaid).toFixed(2));

      if (dto.amount > pendingAmount) {
        throw new BadRequestException(
          `El pago supera la deuda pendiente. Saldo pendiente: ${pendingAmount.toFixed(2)}`,
        );
      }

      if (dto.method === SupplierPaymentMethod.SUPPLIER_CREDIT) {
        // Bloquea al proveedor para que dos pagos simultáneos no usen el
        // mismo saldo a favor.
        await manager.getRepository(Supplier).findOne({
          where: { id: purchase.supplierId },
          lock: { mode: 'pessimistic_write' },
        });

        const balance = await getSupplierCreditBalance(
          manager,
          purchase.supplierId,
        );

        if (dto.amount > balance) {
          throw new BadRequestException(
            `El proveedor no tiene saldo a favor suficiente. Saldo disponible: ${balance.toFixed(2)}`,
          );
        }
      }

      const payment = paymentRepository.create(dto);

      const savedPayment = await paymentRepository.save(payment);

      const newTotalPaid = Number((currentPaid + dto.amount).toFixed(2));

      purchase.paymentStatus = resolvePurchasePaymentStatus(
        purchaseTotal,
        newTotalPaid,
      );

      await purchaseRepository.save(purchase);

      return {
        payment: savedPayment,
        paymentStatus: purchase.paymentStatus,
        paidAmount: newTotalPaid,
        pendingAmount: Number((purchaseTotal - newTotalPaid).toFixed(2)),
      };
    });
  }

  async getSupplierCredit(supplierId: string) {
    const supplier = await this.dataSource
      .getRepository(Supplier)
      .findOne({ where: { id: supplierId } });

    if (!supplier) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    const balance = await getSupplierCreditBalance(
      this.dataSource.manager,
      supplierId,
    );

    // Negativos: saldo generado. Positivos: saldo usado para pagar.
    const movements = await this.supplierPaymentsRepository
      .createQueryBuilder('payment')
      .innerJoin(Purchase, 'purchase', 'purchase.id = payment.purchaseId')
      .where('purchase.supplierId = :supplierId', { supplierId })
      .andWhere('payment.method = :method', {
        method: SupplierPaymentMethod.SUPPLIER_CREDIT,
      })
      .orderBy('payment.createdAt', 'ASC')
      .getMany();

    return {
      supplierId,
      balance,
      movements,
    };
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
