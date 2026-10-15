import { Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import { arcaConfig } from '../config/arca.config.js';
import type { ArcaConfig } from '../config/arca.config.js';
import {
  FACTURA_A,
  IVA_CONDITION_LABEL,
  IVA_CONSUMIDOR_FINAL,
  VOUCHER,
  formatVoucherNumber,
  resolveDocument,
} from './invoice-calc.js';
import type { InvoiceLine } from './invoice-calc.js';

// URL base del QR según la especificación de ARCA
const QR_BASE_URL = 'https://www.afip.gob.ar/fe/qr/';

export interface InvoicePdfData {
  // Borrador: vista previa antes de emitir, sin número, CAE ni QR.
  draft: boolean;
  cbteTipo: number;
  ptoVta: number;
  cbteNro: number | null;
  cbteFch: string | null; // YYYY-MM-DD
  cae: string | null;
  caeVto: string | null;
  receiver: {
    name: string;
    address: string | null;
    taxId: string | null;
    taxCondition: number;
  };
  lines: InvoiceLine[];
  totalCents: number;
  netCents: number;
  vatCents: number;
  vatByRate: { rate: number; vatCents: number }[];
}

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
    @Inject(arcaConfig.KEY)
    private readonly arca: ArcaConfig,
  ) {}

  filename(data: Pick<InvoicePdfData, 'cbteTipo' | 'ptoVta' | 'cbteNro'>) {
    if (!data.cbteNro) return 'factura-borrador.pdf';
    return `${this.arca.cuit}_${String(data.cbteTipo).padStart(3, '0')}_${String(data.ptoVta).padStart(5, '0')}_${String(data.cbteNro).padStart(8, '0')}.pdf`;
  }

  async render(data: InvoicePdfData): Promise<Buffer> {
    const isA = data.cbteTipo === FACTURA_A;
    const voucher = VOUCHER[data.cbteTipo] ?? { letter: '?', code: '000' };

    const { cuit, business } = this.arca;
    const number = data.cbteNro
      ? formatVoucherNumber(data.ptoVta, data.cbteNro)
      : `${String(data.ptoVta).padStart(5, '0')}-(a asignar)`;
    const { docTipo, docNro } = resolveDocument(data.receiver.taxId);

    // ---------- QR fiscal (solo comprobantes autorizados) ----------
    let qrBuffer: Buffer | null = null;

    if (!data.draft && data.cae && data.cbteNro) {
      const qrData = {
        ver: 1,
        fecha: data.cbteFch,
        cuit: Number(cuit),
        ptoVta: data.ptoVta,
        tipoCmp: data.cbteTipo,
        nroCmp: data.cbteNro,
        importe: data.totalCents / 100,
        moneda: 'PES',
        ctz: 1,
        tipoDocRec: docTipo,
        nroDocRec: docNro,
        tipoCodAut: 'E', // E = CAE
        codAut: Number(data.cae),
      };

      const qrUrl = `${QR_BASE_URL}?p=${Buffer.from(JSON.stringify(qrData)).toString('base64')}`;
      qrBuffer = await QRCode.toBuffer(qrUrl, { margin: 1, width: 300 });
    }

    // ---------- Dibujo del PDF ----------
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: data.draft
          ? `Borrador de factura ${voucher.letter}`
          : `Factura ${voucher.letter} ${number}`,
      },
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
      .text(data.draft ? 'BORRADOR - SIN VALIDEZ FISCAL' : 'ORIGINAL', 40, 28, {
        width: 515,
        align: 'center',
      });

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
      .text(business.name, 50, 58, { width: 215 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`${business.address}\n${business.ivaCondition}`, 50, 100, {
        width: 215,
      });

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('FACTURA', 335, 55, { width: 210 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`N° ${number}`, 335, 80, { width: 210 })
      .text(
        `Fecha de emisión: ${data.cbteFch ? formatDate(data.cbteFch) : '(al emitir)'}`,
        335,
        94,
        { width: 210 },
      )
      .text(`CUIT: ${cuit}`, 335, 108, { width: 210 })
      .text(`Ingresos Brutos: ${business.iibb}`, 335, 122, {
        width: 210,
      })
      .text(`Inicio de actividades: ${business.activityStart}`, 335, 136, {
        width: 210,
      });

    // Receptor
    const docLabel = docTipo === 80 ? 'CUIT' : docTipo === 96 ? 'DNI' : 'Doc.';
    const docValue = docTipo === 99 ? 'No informado' : String(docNro);

    doc.rect(40, 165, 515, 56).stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`Cliente: ${data.receiver.name || 'Consumidor Final'}`, 50, 173, {
        width: 270,
      })
      .text(`Domicilio: ${data.receiver.address || '-'}`, 50, 195, {
        width: 270,
      })
      .text(`${docLabel}: ${docValue}`, 335, 173, { width: 210 })
      .text(
        `Condición frente al IVA: ${IVA_CONDITION_LABEL[data.receiver.taxCondition] ?? IVA_CONDITION_LABEL[IVA_CONSUMIDOR_FINAL]}`,
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

    for (const line of data.lines) {
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
        line.rate ? `${String(line.rate).replace('.', ',')}%` : '-',
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
          { label: 'Importe neto gravado', cents: data.netCents },
          ...data.vatByRate.map((v) => ({
            label: `IVA ${String(v.rate).replace('.', ',')}%`,
            cents: v.vatCents,
          })),
          { label: 'Importe total', cents: data.totalCents, bold: true },
        ]
      : data.vatCents > 0
        ? [
            { label: 'Importe total', cents: data.totalCents, bold: true },
            { label: 'IVA contenido', cents: data.vatCents },
          ]
        : [{ label: 'Importe total', cents: data.totalCents, bold: true }];

    totals.forEach((row) => {
      doc
        .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(row.bold ? 10 : 9)
        .text(row.label, 345, y, { width: 115 })
        .text(money(row.cents), 455, y, { width: 95, align: 'right' });
      y += 15;
    });

    // Pie: QR + CAE, o la aclaración del borrador
    if (qrBuffer) {
      doc.image(qrBuffer, 40, 700, { width: 90 });
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Comprobante Autorizado', 145, 712, { width: 300 });
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(`CAE N°: ${data.cae}`, 145, 730, { width: 300 })
        .text(`Fecha de Vto. de CAE: ${formatDate(data.caeVto)}`, 145, 744, {
          width: 300,
        });
    } else {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(
          'Vista previa: el número, la fecha y el CAE los asigna ARCA al emitir.',
          40,
          720,
          { width: 515, align: 'center' },
        );
    }

    doc.end();

    return finished;
  }
}
