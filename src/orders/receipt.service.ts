import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import PDFDocument from 'pdfkit';

import { arcaConfig } from '../config/arca.config.js';
import type { ArcaConfig } from '../config/arca.config.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { OrderItem } from '../order-items/entities/order-item.entity.js';
import { Payment } from '../payments/entities/payments.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { User } from '../users/entities/user.entity.js';

import { Order, OrderStatus } from './entities/order.entity.js';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  mercado_pago: 'Mercado Pago',
};

const money = (value: number) =>
  '$ ' +
  new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const quantity = (value: number) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(value);

const round = (value: number) => Number(value.toFixed(2));

// Fecha y hora argentina (UTC-3), sin depender de la zona del servidor.
const formatDateTime = (date: Date) => {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString();
  return `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}`;
};

export const formatReceiptNumber = (number: number) =>
  `0001-${String(number).padStart(8, '0')}`;

export type ReceiptData = {
  orderId: string;
  number: number;
  deliveredAt: Date;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    taxId: string | null;
  };
  driverName: string | null;
  lines: {
    name: string;
    unit: string;
    qty: number;
    unitPrice: number;
    subtotal: number;
  }[];
  total: number;
  payments: { method: string; amount: number }[];
  collected: number;
  // Lo que quedó de esta entrega en cuenta corriente.
  pending: number;
  debtCollected: number;
  // Saldo total del cliente en cuenta corriente (solo si se le cobra la
  // deuda en las entregas).
  balance: number | null;
  comment: string | null;
};

// Recibo X de una entrega: lo que se entregó (kilos reales), lo cobrado y lo
// que quedó en cuenta corriente. No es una factura.
@Injectable()
export class ReceiptService {
  constructor(
    private readonly dataSource: DataSource,

    @Inject(arcaConfig.KEY)
    private readonly arca: ArcaConfig,
  ) {}

  filename(data: Pick<ReceiptData, 'number'>) {
    return `recibo-x-${formatReceiptNumber(data.number)}.pdf`;
  }

  async data(orderId: string): Promise<ReceiptData> {
    const manager = this.dataSource.manager;
    const order = await manager.getRepository(Order).findOneBy({ id: orderId });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (order.status !== OrderStatus.DELIVERED || !order.receiptNumber) {
      throw new ConflictException(
        'El recibo se genera cuando se confirma la entrega',
      );
    }

    const [items, payments, customer, driver] = await Promise.all([
      manager
        .getRepository(OrderItem)
        .find({ where: { orderId }, order: { createdAt: 'ASC', id: 'ASC' } }),
      manager
        .getRepository(Payment)
        .find({ where: { orderId }, order: { createdAt: 'ASC' } }),
      manager.getRepository(Customer).findOneBy({ id: order.customerId }),
      order.deliveredById
        ? manager.getRepository(User).findOne({
            select: { id: true, name: true },
            where: { id: order.deliveredById },
          })
        : null,
    ]);

    const delivered = items.filter((item) => Number(item.quantity) > 0);
    const products = delivered.length
      ? await manager
          .getRepository(Product)
          .findBy({ id: In(delivered.map((item) => item.productId)) })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const byMethod = new Map<string, number>();
    for (const payment of payments) {
      byMethod.set(
        payment.method,
        round((byMethod.get(payment.method) ?? 0) + Number(payment.amount)),
      );
    }

    const total = Number(order.total);
    const collected = round(
      payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );

    return {
      orderId,
      number: order.receiptNumber,
      deliveredAt: order.deliveredAt ?? order.updatedAt,
      customer: {
        id: order.customerId,
        name: customer?.name ?? 'Cliente',
        phone: customer?.phone ?? null,
        address: customer?.address ?? null,
        taxId: customer?.taxId ?? null,
      },
      driverName: driver?.name ?? null,
      lines: delivered.map((item) => {
        const product = productById.get(item.productId);
        return {
          name: product?.name ?? 'Producto',
          unit: product?.unit === 'unit' ? 'u.' : 'kg',
          qty: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          subtotal: Number(item.subtotal),
        };
      }),
      total,
      payments: [...byMethod].map(([method, amount]) => ({ method, amount })),
      collected,
      pending: round(Math.max(total - collected, 0)),
      debtCollected: Number(order.debtCollected ?? 0),
      balance: customer?.collectDebt
        ? await this.balanceOf(order.customerId)
        : null,
      comment: order.deliveryComment ?? null,
    };
  }

  async pdf(orderId: string) {
    const data = await this.data(orderId);
    return {
      data,
      buffer: await this.render(data),
      filename: this.filename(data),
    };
  }

  private async balanceOf(customerId: string) {
    const row: { balance: string | null } | undefined = await this.dataSource
      .getRepository(Order)
      .createQueryBuilder('o')
      .leftJoin(
        (sub) =>
          sub
            .select('payment.orderId', 'orderId')
            .addSelect('SUM(payment.amount)', 'paid')
            .from(Payment, 'payment')
            .groupBy('payment.orderId'),
        'pay',
        'pay."orderId" = o.id',
      )
      .select('SUM(o.total - COALESCE(pay.paid, 0))', 'balance')
      .where('o.status = :delivered', { delivered: OrderStatus.DELIVERED })
      .andWhere('o.customerId = :customerId', { customerId })
      .andWhere('o.total - COALESCE(pay.paid, 0) > 0')
      .getRawOne();

    return round(Number(row?.balance ?? 0));
  }

  render(data: ReceiptData): Promise<Buffer> {
    const business = this.arca.business;
    const businessName = business.name || 'DF Achuras';
    const number = formatReceiptNumber(data.number);

    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: { Title: `Recibo X ${number}` },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    doc.lineWidth(0.5);

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('DOCUMENTO NO VÁLIDO COMO FACTURA', 40, 28, {
        width: 515,
        align: 'center',
      });

    // Cabecera con la X al medio
    doc.rect(40, 45, 515, 95).stroke();
    doc.rect(272.5, 45, 50, 50).fillAndStroke('#ffffff', '#000000');
    doc.moveTo(297.5, 95).lineTo(297.5, 140).stroke();

    doc
      .fillColor('#000000')
      .font('Helvetica-Bold')
      .fontSize(28)
      .text('X', 272.5, 53, { width: 50, align: 'center' });

    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(businessName, 50, 58, { width: 215 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        [business.address, business.ivaCondition].filter(Boolean).join('\n'),
        50,
        95,
        { width: 215 },
      );

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('RECIBO', 335, 55, { width: 210 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`N° ${number}`, 335, 80, { width: 210 })
      .text(`Fecha: ${formatDateTime(data.deliveredAt)}`, 335, 94, {
        width: 210,
      });
    if (data.driverName) {
      doc.text(`Repartidor: ${data.driverName}`, 335, 108, { width: 210 });
    }

    // Cliente
    doc.rect(40, 150, 515, 48).stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`Cliente: ${data.customer.name}`, 50, 158, { width: 270 })
      .text(`Domicilio: ${data.customer.address || '-'}`, 50, 178, {
        width: 270,
      })
      .text(`Teléfono: ${data.customer.phone || '-'}`, 335, 158, {
        width: 210,
      });
    if (data.customer.taxId) {
      doc.text(
        `${data.customer.taxId.length === 11 ? 'CUIT' : 'DNI'}: ${data.customer.taxId}`,
        335,
        178,
        { width: 210 },
      );
    }

    // Detalle
    const cols = [
      { label: 'Producto', x: 46, w: 230, align: 'left' },
      { label: 'Cantidad', x: 280, w: 70, align: 'right' },
      { label: 'Precio unit.', x: 355, w: 90, align: 'right' },
      { label: 'Subtotal', x: 450, w: 99, align: 'right' },
    ] as const;

    const drawTableHeader = (y: number) => {
      doc.rect(40, y, 515, 18).fill('#eeeeee');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8.5);
      cols.forEach((c) =>
        doc.text(c.label, c.x, y + 5, { width: c.w, align: c.align }),
      );
    };

    let y = 212;
    drawTableHeader(y);
    y += 24;
    doc.font('Helvetica').fontSize(9);

    for (const line of data.lines) {
      if (y > 660) {
        doc.addPage();
        y = 40;
        drawTableHeader(y);
        y += 24;
        doc.font('Helvetica').fontSize(9);
      }

      const cells = [
        line.name,
        `${quantity(line.qty)} ${line.unit}`,
        money(line.unitPrice),
        money(line.subtotal),
      ];
      cols.forEach((c, i) =>
        doc.text(cells[i], c.x, y, {
          width: c.w,
          align: c.align,
          height: 12,
          ellipsis: true,
        }),
      );
      y += 18;
    }

    if (y > 560) {
      doc.addPage();
      y = 40;
    }

    // Totales
    y += 6;
    doc.moveTo(270, y).lineTo(555, y).stroke();
    y += 8;

    const rows: { label: string; value: number; bold?: boolean }[] = [
      { label: 'Total de la entrega', value: data.total, bold: true },
      ...data.payments.map((payment) => ({
        label: `Pagado en ${(METHOD_LABEL[payment.method] ?? payment.method).toLowerCase()}`,
        value: payment.amount,
      })),
      ...(data.debtCollected > 0
        ? [{ label: 'Pago de deuda anterior', value: data.debtCollected }]
        : []),
      { label: 'Queda en cuenta corriente', value: data.pending },
      ...(data.balance !== null
        ? [
            {
              label: 'Saldo total en cuenta corriente',
              value: data.balance,
              bold: true,
            },
          ]
        : []),
    ];

    for (const row of rows) {
      doc
        .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(row.bold ? 10.5 : 9.5)
        .text(row.label, 275, y, { width: 180 })
        .text(money(row.value), 455, y, { width: 95, align: 'right' });
      y += 16;
    }

    if (data.comment) {
      y += 10;
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(`Observaciones: ${data.comment}`, 40, y, { width: 515 });
    }

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#555555')
      .text(
        'Comprobante interno de entrega y cobro. Documento no válido como factura.',
        40,
        780,
        { width: 515, align: 'center' },
      );

    doc.end();

    return finished;
  }
}
