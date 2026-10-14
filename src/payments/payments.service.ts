import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository, DataSource } from 'typeorm';

import { Payment } from './entities/payments.entity.js';
import {
  Order,
  OrderPaymentStatus,
  OrderStatus,
} from '../orders/entities/order.entity.js';

import { CreatePaymentDto } from './dto/create-payment.dto.js';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,

    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    private readonly dataSource: DataSource,
  ) {}

  // collectedById: quién registra el cobro (para la rendición).
  async create(createPaymentDto: CreatePaymentDto, collectedById?: string) {
    const { orderId, amount, method, notes } = createPaymentDto;

    return this.dataSource.transaction(async (manager) => {
      const orderRepository = manager.getRepository(Order);

      const paymentRepository = manager.getRepository(Payment);

      // Bloquea el pedido hasta el fin de la transacción: dos pagos
      // simultáneos no pueden superar el saldo pendiente.
      const order = await orderRepository.findOne({
        where: {
          id: orderId,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!order) {
        throw new NotFoundException('Pedido no encontrado');
      }

      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException(
          'No se puede registrar un pago para un pedido cancelado',
        );
      }

      // Antes de pesar no se sabe el total: se cobra al entregar.
      if (order.status === OrderStatus.PENDING) {
        throw new BadRequestException(
          'La nota de pedido todavía no se entregó: el cobro se registra al entregarla',
        );
      }

      const payments = await paymentRepository.find({
        where: {
          orderId,
        },
      });

      const totalPaid = payments.reduce(
        (sum, payment) => sum + Number(payment.amount),
        0,
      );

      const orderTotal = Number(Number(order.total).toFixed(2));

      const currentPaid = Number(totalPaid.toFixed(2));

      const pendingAmount = Number((orderTotal - currentPaid).toFixed(2));

      if (amount > pendingAmount) {
        throw new BadRequestException(
          `El pago supera el saldo pendiente. Saldo pendiente: ${pendingAmount.toFixed(2)}`,
        );
      }

      const payment = paymentRepository.create({
        orderId,
        amount,
        method,
        notes,
        collectedById,
      });

      const savedPayment = await paymentRepository.save(payment);

      const newTotalPaid = Number((currentPaid + amount).toFixed(2));

      if (newTotalPaid === 0) {
        order.paymentStatus = OrderPaymentStatus.PENDING;
      } else if (newTotalPaid < orderTotal) {
        order.paymentStatus = OrderPaymentStatus.PARTIAL;
      } else {
        order.paymentStatus = OrderPaymentStatus.PAID;
      }

      await orderRepository.save(order);

      const newPendingAmount = Number((orderTotal - newTotalPaid).toFixed(2));

      return {
        payment: savedPayment,
        paymentStatus: order.paymentStatus,
        paidAmount: newTotalPaid,
        pendingAmount: newPendingAmount,
      };
    });
  }

  async findByOrder(orderId: string) {
    const order = await this.ordersRepository.findOne({
      where: {
        id: orderId,
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const payments = await this.paymentsRepository.find({
      where: {
        orderId,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    const paidAmount = payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    const total = Number(order.total);

    const pendingAmount = Number((total - paidAmount).toFixed(2));

    return {
      orderId,
      total,
      paidAmount: Number(paidAmount.toFixed(2)),
      pendingAmount,
      paymentStatus: order.paymentStatus,
      payments,
    };
  }
}
