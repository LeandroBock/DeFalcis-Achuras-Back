import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { existsSync, readFileSync } from 'node:fs';
import Afip from '@afipsdk/afip.js';

import { Invoice, InvoiceStatus } from './entities/invoice.entity.js';
import { Order, OrderStatus } from '../orders/entities/order.entity.js';
import { OrderItem } from '../order-items/entities/order-item.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';

export interface EmitResult {
  orderId: string;
  ok: boolean;
  cbteTipo?: number;
  cbteNro?: number;
  cae?: string;
  error?: string;
}

const INVOICEABLE_STATUSES = [OrderStatus.CONFIRMED, OrderStatus.DELIVERED];

// Tipos de comprobante
const FACTURA_A = 1;
const FACTURA_B = 6;

// Condición IVA del receptor
const IVA_RESP_INSCRIPTO = 1;
const IVA_MONOTRIBUTO = 6;

// Alícuota (%) -> Id de ARCA (FEParamGetTiposIva)
const VAT_ID_BY_RATE: Record<string, number> = {
  '0': 3,
  '2.5': 9,
  '5': 8,
  '10.5': 4,
  '21': 5,
  '27': 6,
};

const toCents = (value: number | string) => Math.round(Number(value) * 100);

@Injectable()
export class InvoicingService {
  private afipClient: any;

// Se crea recién al emitir, así un certificado faltante no tumba el arranque
private get afip() {
  if (!this.afipClient) {
    const certPath = process.env.ARCA_CERT_PATH;
    const keyPath = process.env.ARCA_KEY_PATH;

    const options: Record<string, unknown> = {
      CUIT: Number(process.env.ARCA_CUIT),
      production: process.env.ARCA_PRODUCTION === 'true',
      access_token: process.env.AFIPSDK_ACCESS_TOKEN ?? '',
    };

    if (certPath && keyPath) {
      if (!existsSync(certPath) || !existsSync(keyPath)) {
        throw new Error(
          `No se encontró el certificado o la clave de ARCA (${certPath}, ${keyPath})`,
        );
      }

      options.cert = readFileSync(certPath, 'utf8');
      options.key = readFileSync(keyPath, 'utf8');
    }

    this.afipClient = new Afip(options as any);
  }

  return this.afipClient;
}
  private readonly ptoVta = Number(process.env.ARCA_PTO_VTA ?? 1);
  private queue: Promise<unknown> = Promise.resolve();

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

  findAll() {
    return this.invoicesRepository.find({ order: { createdAt: 'DESC' } });
  }

  async emit(orderIds: string[]): Promise<EmitResult[]> {
    const results: EmitResult[] = [];

    // Una por una: ARCA exige numeración correlativa
    for (const orderId of orderIds) {
      results.push(await this.enqueue(() => this.emitOne(orderId)));
    }

    return results;
  }

  // Serializa las emisiones aunque lleguen requests simultáneos
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async emitOne(orderId: string): Promise<EmitResult> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
    });

    if (!order) {
      return { orderId, ok: false, error: 'Venta no encontrada' };
    }

    if (!INVOICEABLE_STATUSES.includes(order.status)) {
      return {
        orderId,
        ok: false,
        error: 'Solo se pueden facturar ventas confirmadas o entregadas',
      };
    }

    let invoice = await this.invoicesRepository.findOne({ where: { orderId } });

    if (invoice?.status === InvoiceStatus.AUTHORIZED) {
      return { orderId, ok: false, error: 'La venta ya tiene factura' };
    }

    if (invoice?.status === InvoiceStatus.PENDING) {
      return {
        orderId,
        ok: false,
        error:
          'Hay una emisión sin confirmar para esta venta. Verificala en ARCA antes de reintentar',
      };
    }

    // ---------- Cliente y tipo de comprobante ----------
    const customer = await this.customersRepository.findOne({
      where: { id: order.customerId },
    });

    const condition = customer?.taxCondition ?? 5;
    const cbteTipo = [IVA_RESP_INSCRIPTO, IVA_MONOTRIBUTO].includes(condition)
      ? FACTURA_A
      : FACTURA_B;

    const { docTipo, docNro } = this.resolveDocument(customer?.taxId);

    if (cbteTipo === FACTURA_A && docTipo !== 80) {
      return {
        orderId,
        ok: false,
        error: 'Para Factura A el cliente necesita un CUIT válido cargado',
      };
    }

    // ---------- Importes: neto, IVA y total por alícuota ----------
    const items = await this.orderItemsRepository.find({ where: { orderId } });

    if (items.length === 0) {
      return { orderId, ok: false, error: 'La venta no tiene productos' };
    }

const products = await this.productsRepository.find({
  where: { id: In(items.map((item) => item.productId)) },
});
    const productById = new Map(products.map((p) => [p.id, p]));

    // alícuota -> total con IVA incluido, en centavos
    const grossByRate = new Map<number, number>();

    for (const item of items) {
      const product = productById.get(item.productId);
      const rate = Number(product?.vatRate ?? 21);

      if (VAT_ID_BY_RATE[String(rate)] === undefined) {
        return {
          orderId,
          ok: false,
          error: `Alícuota de IVA no válida (${rate}%) en ${product?.name ?? 'un producto'}`,
        };
      }

      grossByRate.set(
        rate,
        (grossByRate.get(rate) ?? 0) + toCents(item.subtotal),
      );
    }

    let totalCents = 0;
    let netCents = 0;
    let vatCents = 0;

    const iva = [...grossByRate.entries()].map(([rate, grossCents]) => {
      const baseCents = Math.round(grossCents / (1 + rate / 100));
      const ivaCents = grossCents - baseCents;

      totalCents += grossCents;
      netCents += baseCents;
      vatCents += ivaCents;

      return {
        Id: VAT_ID_BY_RATE[String(rate)],
        BaseImp: baseCents / 100,
        Importe: ivaCents / 100,
      };
    });

    if (totalCents <= 0) {
      return { orderId, ok: false, error: 'La venta no tiene importe' };
    }

    // Seguridad: los ítems tienen que coincidir con el total de la venta
    if (Math.abs(totalCents - toCents(order.total)) > 1) {
      return {
        orderId,
        ok: false,
        error: 'El total de la venta no coincide con la suma de sus productos',
      };
    }

    // ---------- Registro local del intento ----------
    if (invoice) {
      invoice.status = InvoiceStatus.PENDING;
      invoice.errorMessage = null;
      invoice.cbteTipo = cbteTipo;
      invoice.total = totalCents / 100;
      invoice.netAmount = netCents / 100;
      invoice.vatAmount = vatCents / 100;
      invoice = await this.invoicesRepository.save(invoice);
    } else {
      invoice = await this.invoicesRepository.save(
        this.invoicesRepository.create({
          orderId,
          ptoVta: this.ptoVta,
          cbteTipo,
          total: totalCents / 100,
          netAmount: netCents / 100,
          vatAmount: vatCents / 100,
          status: InvoiceStatus.PENDING,
        }),
      );
    }

    // ---------- Pedido a ARCA ----------
    try {
      const last = await this.afip.ElectronicBilling.getLastVoucher(
        this.ptoVta,
        cbteTipo,
      );
      const cbteNro = Number(last) + 1;
      const today = this.todayInArgentina(); // YYYY-MM-DD

      const response = await this.afip.ElectronicBilling.createVoucher({
        CantReg: 1,
        PtoVta: this.ptoVta,
        CbteTipo: cbteTipo,
        Concepto: 1, // 1 = Productos
        DocTipo: docTipo,
        DocNro: docNro,
        CbteDesde: cbteNro,
        CbteHasta: cbteNro,
        CbteFch: Number(today.replaceAll('-', '')),
        ImpTotal: totalCents / 100,
        ImpTotConc: 0,
        ImpNeto: netCents / 100,
        ImpOpEx: 0,
        ImpIVA: vatCents / 100,
        ImpTrib: 0,
        MonId: 'PES',
        MonCotiz: 1,
        CondicionIVAReceptorId: condition,
        Iva: iva,
      });

      invoice.status = InvoiceStatus.AUTHORIZED;
      invoice.cbteNro = cbteNro;
      invoice.cae = response.CAE;
      invoice.caeVto = response.CAEFchVto;
      invoice.cbteFch = today;
      await this.invoicesRepository.save(invoice);

      return { orderId, ok: true, cbteTipo, cbteNro, cae: response.CAE };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error desconocido de ARCA';

      invoice.status = InvoiceStatus.REJECTED;
      invoice.errorMessage = message;
      await this.invoicesRepository.save(invoice);

      return { orderId, ok: false, error: message };
    }
  }

  // 80 = CUIT, 96 = DNI, 99 = Consumidor Final sin identificar
  private resolveDocument(taxId?: string | null) {
    const digits = (taxId ?? '').replace(/\D/g, '');

    if (digits.length === 11) return { docTipo: 80, docNro: Number(digits) };
    if (digits.length >= 7 && digits.length <= 8) {
      return { docTipo: 96, docNro: Number(digits) };
    }
    return { docTipo: 99, docNro: 0 };
  }

  private todayInArgentina() {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    });
  }
}