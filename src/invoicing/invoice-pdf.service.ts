import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import { Invoice, InvoiceStatus } from './entities/invoice.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../order-items/entities/order-item.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';

// URL base del QR según la especificación de ARCA
const QR_BASE_URL = 'https://www.afip.gob.ar/fe/qr/';

const VOUCHER: Record<number, { letter: string; code: string }> = {
  1: { letter: 'A', code: '001' },
  6: { letter: 'B', code: '006' },
};

const IVA_CONDITION_LABEL: Record<number, string> = {
  1: 'IVA Responsable Inscripto',
  4: 'IVA Sujeto Exento',
  5: 'Consumidor Final',
  6: 'Responsable Monotributo',
};

const toCents = (value: number | string) => Math.round(Number(value) * 100);

const money = (cents: number) =>
  '$ ' +
  new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

const quantity = (value: number) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(value);

// 'YYYY-MM-DD' -> 'DD/MM/YYYY'
const formatDate = (value?: string | null) =>
  value ? value.slice(0, 10).split('-').reverse().join('/') : '';

@Injectable()
export class InvoicePdfService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,

    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,

    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
  ) {}

  async generate(invoiceId: string) {
    const invoice = await this.invoicesRepository.findOne({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new NotFoundException('Factura no encontrada');
    }

    if (
      invoice.status !== InvoiceStatus.AUTHORIZED ||
      !invoice.cae ||
      !invoice.cbteNro
    ) {
      throw new BadRequestException(
        'La factura todavía no fue autorizada por ARCA',
      );
    }

    const order = await this.ordersRepository.findOne({
      where: { id: invoice.orderId },
    });

    if (!order) {
      throw new NotFoundException('Venta no encontrada');
    }

    const [customer, items] = await Promise.all([
      this.customersRepository.findOne({ where: { id: order.customerId } }),
      this.orderItemsRepository.find({ where: { orderId: order.id } }),
    ]);

    const products = items.length
      ? await this.productsRepository.find({
          where: { id: In(items.map((item) => item.productId)) },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const isA = invoice.cbteTipo === 1;
    const voucher = VOUCHER[invoice.cbteTipo] ?? { letter: '?', code: '000' };

    const cuit = process.env.ARCA_CUIT ?? '';
    const number = `${String(invoice.ptoVta).padStart(5, '0')}-${String(invoice.cbteNro).padStart(8, '0')}`;
    const { docTipo, docNro } = this.resolveDocument(customer?.taxId);

    // ---------- Renglones y totales (mismo criterio que la emisión) ----------
    const lines = items.map((item) => {
      const product = productById.get(item.productId);
      const rate = Number(product?.vatRate ?? 21);
      const grossCents = toCents(item.subtotal);
      const factor = 1 + rate / 100;

      return {
        name: product?.name ?? 'Producto',
        unit: product?.unit === 'kg' ? 'kg' : 'u.',
        qty: Number(item.quantity),
        rate,
        grossCents,
        netCents: Math.round(grossCents / factor),
        unitGrossCents: toCents(item.unitPrice),
        unitNetCents: Math.round(toCents(item.unitPrice) / factor),
      };
    });

    const grossByRate = new Map<number, number>();
    lines.forEach((l) =>
      grossByRate.set(l.rate, (grossByRate.get(l.rate) ?? 0) + l.grossCents),
    );

    let totalCents = 0;
    let netCents = 0;
    let vatCents = 0;
    const vatByRate: { rate: number; vatCents: number }[] = [];

    [...grossByRate.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([rate, gross]) => {
        const base = Math.round(gross / (1 + rate / 100));
        totalCents += gross;
        netCents += base;
        vatCents += gross - base;
        vatByRate.push({ rate, vatCents: gross - base });
      });

    // ---------- QR fiscal ----------
    const qrData = {
      ver: 1,
      fecha: invoice.cbteFch,
      cuit: Number(cuit),
      ptoVta: invoice.ptoVta,
      tipoCmp: invoice.cbteTipo,
      nroCmp: invoice.cbteNro,
      importe: Number(invoice.total),
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: docTipo,
      nroDocRec: docNro,
      tipoCodAut: 'E', // E = CAE
      codAut: Number(invoice.cae),
    };

    const qrUrl = `${QR_BASE_URL}?p=${Buffer.from(JSON.stringify(qrData)).toString('base64')}`;
    const qrBuffer = await QRCode.toBuffer(qrUrl, { margin: 1, width: 300 });

    // ---------- Dibujo del PDF ----------
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: { Title: `Factura ${voucher.letter} ${number}` },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    doc.lineWidth(0.5);

    // Leyenda
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('ORIGINAL', 40, 28, { width: 515, align: 'center' });

    // Cabecera
    doc.rect(40, 45, 515, 110).stroke();
    doc.rect(272.5, 45, 50, 50).fillAndStroke('#ffffff', '#000000');
    doc.moveTo(297.5, 95).lineTo(297.5, 155).stroke();

    doc
      .fillColor('#000000')
      .font('Helvetica-Bold')
      .fontSize(28)
      .text(voucher.letter, 272.5, 51, { width: 50, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(7)
      .text(`COD. ${voucher.code}`, 272.5, 83, { width: 50, align: 'center' });

    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(process.env.ARCA_BUSINESS_NAME ?? '', 50, 58, { width: 215 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        `${process.env.ARCA_BUSINESS_ADDRESS ?? ''}\n${process.env.ARCA_IVA_CONDITION ?? ''}`,
        50,
        100,
        { width: 215 },
      );

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('FACTURA', 335, 55, { width: 210 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`N° ${number}`, 335, 80, { width: 210 })
      .text(`Fecha de emisión: ${formatDate(invoice.cbteFch)}`, 335, 94, {
        width: 210,
      })
      .text(`CUIT: ${cuit}`, 335, 108, { width: 210 })
      .text(`Ingresos Brutos: ${process.env.ARCA_IIBB ?? ''}`, 335, 122, {
        width: 210,
      })
      .text(
        `Inicio de actividades: ${process.env.ARCA_ACTIVITY_START ?? ''}`,
        335,
        136,
        { width: 210 },
      );

    // Receptor
    const docLabel = docTipo === 80 ? 'CUIT' : docTipo === 96 ? 'DNI' : 'Doc.';
    const docValue = docTipo === 99 ? 'No informado' : String(docNro);

    doc.rect(40, 165, 515, 56).stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`Cliente: ${customer?.name ?? 'Consumidor Final'}`, 50, 173, {
        width: 270,
      })
      .text(`Domicilio: ${customer?.address ?? '-'}`, 50, 195, { width: 270 })
      .text(`${docLabel}: ${docValue}`, 335, 173, { width: 210 })
      .text(
        `Condición frente al IVA: ${IVA_CONDITION_LABEL[customer?.taxCondition ?? 5] ?? 'Consumidor Final'}`,
        335,
        195,
        { width: 210 },
      );

    // Tabla
    const cols = [
      { label: 'Descripción', x: 46, w: 190, align: 'left' },
      { label: 'Cant.', x: 240, w: 50, align: 'right' },
      { label: 'Unid.', x: 298, w: 32, align: 'left' },
      {
        label: isA ? 'Precio unit. (neto)' : 'Precio unit.',
        x: 330,
        w: 80,
        align: 'right',
      },
      { label: 'IVA', x: 414, w: 36, align: 'right' },
      {
        label: isA ? 'Subtotal (neto)' : 'Subtotal',
        x: 454,
        w: 95,
        align: 'right',
      },
    ] as const;

    const drawTableHeader = (y: number) => {
      doc.rect(40, y, 515, 18).fill('#eeeeee');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);
      cols.forEach((c) =>
        doc.text(c.label, c.x, y + 5, { width: c.w, align: c.align }),
      );
    };

    let y = 235;
    drawTableHeader(y);
    y += 24;

    doc.font('Helvetica').fontSize(8.5);

    for (const line of lines) {
      if (y > 640) {
        doc.addPage();
        y = 40;
        drawTableHeader(y);
        y += 24;
        doc.font('Helvetica').fontSize(8.5);
      }

      const cells = [
        line.name,
        quantity(line.qty),
        line.unit,
        money(isA ? line.unitNetCents : line.unitGrossCents),
        `${String(line.rate).replace('.', ',')}%`,
        money(isA ? line.netCents : line.grossCents),
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

    // Totales
    if (y > 560) {
      doc.addPage();
      y = 40;
    }

    y += 10;
    doc.moveTo(340, y).lineTo(555, y).stroke();
    y += 8;

    const totals: { label: string; cents: number; bold?: boolean }[] = isA
      ? [
          { label: 'Importe neto gravado', cents: netCents },
          ...vatByRate.map((v) => ({
            label: `IVA ${String(v.rate).replace('.', ',')}%`,
            cents: v.vatCents,
          })),
          { label: 'Importe total', cents: totalCents, bold: true },
        ]
      : [
          { label: 'Importe total', cents: totalCents, bold: true },
          { label: 'IVA contenido', cents: vatCents },
        ];

    totals.forEach((row) => {
      doc
        .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(row.bold ? 10 : 9)
        .text(row.label, 345, y, { width: 115 })
        .text(money(row.cents), 455, y, { width: 95, align: 'right' });
      y += 15;
    });

    // Pie: QR + CAE
    doc.image(qrBuffer, 40, 700, { width: 90 });
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Comprobante Autorizado', 145, 712, { width: 300 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`CAE N°: ${invoice.cae}`, 145, 730, { width: 300 })
      .text(`Fecha de Vto. de CAE: ${formatDate(invoice.caeVto)}`, 145, 744, {
        width: 300,
      });

    doc.end();

    const buffer = await finished;
    const filename = `${cuit}_${String(invoice.cbteTipo).padStart(3, '0')}_${String(invoice.ptoVta).padStart(5, '0')}_${String(invoice.cbteNro).padStart(8, '0')}.pdf`;

    return { buffer, filename };
  }

  // Tiene que coincidir con la regla usada al emitir la factura
  private resolveDocument(taxId?: string | null) {
    const digits = (taxId ?? '').replace(/\D/g, '');

    if (digits.length === 11) return { docTipo: 80, docNro: Number(digits) };
    if (digits.length >= 7 && digits.length <= 8) {
      return { docTipo: 96, docNro: Number(digits) };
    }
    return { docTipo: 99, docNro: 0 };
  }
}
