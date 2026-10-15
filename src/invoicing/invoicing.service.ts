import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';

import { Invoice, InvoiceStatus } from './entities/invoice.entity.js';
import { Order, OrderStatus } from '../orders/entities/order.entity.js';
import { OrderItem } from '../order-items/entities/order-item.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import {
  PaginationQueryDto,
  findMaybePaginated,
} from '../common/pagination.js';
import { arcaConfig } from '../config/arca.config.js';
import type { ArcaConfig } from '../config/arca.config.js';
import { MailService } from '../mail/mail.service.js';

import { ARCA_CLIENT } from './arca-client.js';
import type { ArcaClient } from './arca-client.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import type { InvoicePdfData } from './invoice-pdf.service.js';
import {
  FACTURA_A,
  FACTURA_C,
  IVA_CONSUMIDOR_FINAL,
  VAT_ID_BY_RATE,
  VOUCHER,
  computeInvoice,
  formatVoucherNumber,
  isValidCuit,
  issuerIsMonotributo,
  resolveDocument,
  toCents,
  voucherTypeFor,
} from './invoice-calc.js';
import type { InvoiceItemInput } from './invoice-calc.js';
import { BillingDataDto, EmitInvoiceDto } from './dto/emit-invoice.dto.js';

export interface EmitResult {
  orderId: string;
  ok: boolean;
  invoiceId?: string;
  ptoVta?: number;
  cbteTipo?: number;
  cbteNro?: number;
  cae?: string;
  error?: string;
}

export interface EmailResult {
  sent: boolean;
  to: string | null;
  error?: string;
}

export interface Billing {
  name: string;
  taxId: string | null;
  taxCondition: number;
  address: string | null;
  email: string | null;
}

export interface Sale {
  order: Order;
  customer: Customer | null;
  items: InvoiceItemInput[];
}

const digitsOnly = (value?: string | null) => (value ?? '').replace(/\D/g, '');

// Errores con código de ARCA: el comprobante fue rechazado (no existe). Otros
// errores después de pedirlo (corte de red, timeout) dejan la duda de si ARCA
// lo autorizó.
const isArcaRejection = (error: unknown) =>
  error instanceof Error && error.constructor.name === 'AfipWebServiceError';

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger('Facturación');

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

    @Inject(arcaConfig.KEY)
    private readonly arca: ArcaConfig,

    @Inject(ARCA_CLIENT)
    private readonly arcaClient: ArcaClient,

    private readonly pdfService: InvoicePdfService,

    private readonly mailService: MailService,
  ) {}

  private get ptoVta() {
    return this.arca.pointOfSale;
  }

  private get issuerMonotributo() {
    return issuerIsMonotributo(this.arca.business.ivaCondition);
  }

  findAll(query: PaginationQueryDto) {
    return findMaybePaginated(
      this.invoicesRepository,
      { order: { createdAt: 'DESC', id: 'DESC' } },
      query,
    );
  }

  // ---------- Datos de la venta ----------

  private async loadSale(orderId: string): Promise<Sale> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Venta no encontrada');
    }

    const [customer, orderItems] = await Promise.all([
      this.customersRepository.findOne({ where: { id: order.customerId } }),
      this.orderItemsRepository.find({
        where: { orderId },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    ]);

    // Lo que el cliente no quiso (0 kg) no se factura.
    const delivered = orderItems.filter((item) => Number(item.quantity) > 0);

    const products = delivered.length
      ? await this.productsRepository.find({
          where: { id: In(delivered.map((item) => item.productId)) },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const items = delivered.map((item) => {
      const product = productById.get(item.productId);
      return {
        name: product?.name ?? 'Producto',
        unit: product?.unit ?? 'kg',
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        subtotal: Number(item.subtotal),
        vatRate: Number(product?.vatRate ?? 21),
      };
    });

    return { order, customer, items };
  }

  private billingFrom(
    customer: Customer | null,
    data?: BillingDataDto,
  ): Billing {
    const source = data ?? {
      name: customer?.name ?? '',
      taxId: customer?.taxId ?? null,
      taxCondition: customer?.taxCondition ?? IVA_CONSUMIDOR_FINAL,
      address: customer?.address ?? null,
      email: customer?.email ?? null,
    };

    return {
      name: source.name.trim(),
      taxId: digitsOnly(source.taxId) || null,
      taxCondition: Number(source.taxCondition),
      address: source.address?.trim() || null,
      email: source.email?.trim() || null,
    };
  }

  // Tipo de factura, importes y lo que impide emitirla.
  private draft(sale: Sale, billing: Billing) {
    const cbteTipo = voucherTypeFor(
      this.issuerMonotributo,
      billing.taxCondition,
    );
    const calc = computeInvoice(sale.items, cbteTipo);
    const problems: string[] = [];
    const taxId = billing.taxId ?? '';

    if (sale.order.status !== OrderStatus.DELIVERED) {
      problems.push('Solo se pueden facturar notas de pedido ya entregadas');
    }

    if (!billing.name) {
      problems.push('Falta el nombre o razón social del cliente');
    }

    if (taxId && ![7, 8, 11].includes(taxId.length)) {
      problems.push(
        'El CUIT tiene que tener 11 dígitos (o el DNI 7 u 8 dígitos)',
      );
    } else if (taxId.length === 11 && !isValidCuit(taxId)) {
      problems.push('El CUIT no es válido: revisá los números');
    }

    if (cbteTipo === FACTURA_A && taxId.length !== 11) {
      problems.push('Para Factura A el cliente necesita un CUIT válido');
    }

    if (sale.items.length === 0) {
      problems.push('La venta no tiene productos entregados');
    }

    if (calc.invalidRates.length) {
      problems.push(
        `Alícuota de IVA no válida (${calc.invalidRates.join('%, ')}%) en algún producto`,
      );
    }

    if (sale.items.length && calc.totalCents <= 0) {
      problems.push('La venta no tiene importe');
    }

    // Seguridad: los ítems tienen que coincidir con el total de la venta
    if (Math.abs(calc.totalCents - toCents(sale.order.total)) > 1) {
      problems.push(
        'El total de la venta no coincide con la suma de sus productos',
      );
    }

    return { cbteTipo, calc, problems };
  }

  // Vista previa: lo que se va a facturar, con los datos del cliente (los
  // guardados o los corregidos en la ventana de revisión).
  async preview(orderId: string, data?: BillingDataDto) {
    const sale = await this.loadSale(orderId);
    const billing = this.billingFrom(sale.customer, data);
    const { cbteTipo, calc, problems } = this.draft(sale, billing);

    const invoice = await this.invoicesRepository.findOne({
      where: { orderId },
    });

    if (invoice?.status === InvoiceStatus.AUTHORIZED) {
      problems.unshift('La venta ya tiene factura');
    }

    return {
      orderId,
      customerId: sale.order.customerId,
      deliveredAt: sale.order.deliveredAt ?? null,
      customer: billing,
      cbteTipo,
      letter: VOUCHER[cbteTipo].letter,
      pointOfSale: this.ptoVta,
      items: calc.lines.map((line) => ({
        name: line.name,
        unit: line.unit,
        quantity: line.qty,
        vatRate: line.rate,
        unitPrice: line.unitGrossCents / 100,
        subtotal: line.grossCents / 100,
      })),
      total: calc.totalCents / 100,
      net: calc.netCents / 100,
      vat: calc.vatCents / 100,
      problems,
      previousError:
        invoice?.status === InvoiceStatus.REJECTED
          ? invoice.errorMessage
          : null,
      pendingConfirmation: invoice?.status === InvoiceStatus.PENDING,
      emailConfigured: this.mailService.isConfigured,
    };
  }

  // PDF de la vista previa (sin validez fiscal), para guardarlo o revisarlo.
  async draftPdf(orderId: string, data?: BillingDataDto) {
    const sale = await this.loadSale(orderId);
    const billing = this.billingFrom(sale.customer, data);
    const { cbteTipo, calc } = this.draft(sale, billing);

    const buffer = await this.pdfService.render({
      draft: true,
      cbteTipo,
      ptoVta: this.ptoVta,
      cbteNro: null,
      cbteFch: null,
      cae: null,
      caeVto: null,
      receiver: billing,
      ...calc,
    });

    return { buffer, filename: 'factura-borrador.pdf' };
  }

  // ---------- Emisión ----------

  // Emite la factura con los datos revisados, guarda las correcciones en el
  // cliente y la manda por mail.
  async emitReviewed(dto: EmitInvoiceDto) {
    const sale = await this.loadSale(dto.orderId);
    const billing = this.billingFrom(sale.customer, dto.customer);

    const result = await this.enqueue(() => this.emitOne(dto.orderId, billing));

    if (result.ok && dto.saveToCustomer !== false && sale.customer) {
      await this.customersRepository.update(sale.customer.id, {
        name: billing.name,
        taxId: billing.taxId ?? undefined,
        taxCondition: billing.taxCondition,
        address: billing.address ?? undefined,
        email: billing.email ?? undefined,
      });
    }

    let email: EmailResult | null = null;

    if (result.ok && result.invoiceId && dto.sendEmail !== false) {
      email = billing.email
        ? await this.sendEmail(result.invoiceId, billing.email)
        : { sent: false, to: null, error: 'El cliente no tiene mail' };
    }

    return { ...result, email };
  }

  // Serializa las emisiones aunque lleguen requests simultáneos: ARCA exige
  // numeración correlativa.
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async emitOne(
    orderId: string,
    billing: Billing,
  ): Promise<EmitResult> {
    const sale = await this.loadSale(orderId);

    let invoice = await this.invoicesRepository.findOne({ where: { orderId } });

    if (invoice?.status === InvoiceStatus.AUTHORIZED) {
      return { orderId, ok: false, error: 'La venta ya tiene factura' };
    }

    if (invoice?.status === InvoiceStatus.PENDING) {
      const reconciled = await this.reconcilePending(invoice);
      if (reconciled) return reconciled;
    }

    const { cbteTipo, calc, problems } = this.draft(sale, billing);

    if (problems.length) {
      return { orderId, ok: false, error: problems.join('. ') };
    }

    // ---------- Registro local del intento (con los datos facturados) ----------
    invoice = this.invoicesRepository.merge(
      invoice ?? this.invoicesRepository.create({ orderId }),
      {
        ptoVta: this.ptoVta,
        cbteTipo,
        cbteNro: null,
        status: InvoiceStatus.PENDING,
        errorMessage: null,
        total: calc.totalCents / 100,
        netAmount: calc.netCents / 100,
        vatAmount: calc.vatCents / 100,
        customerName: billing.name,
        taxId: billing.taxId,
        taxCondition: billing.taxCondition,
        customerAddress: billing.address,
        customerEmail: billing.email,
      },
    );
    invoice = await this.invoicesRepository.save(invoice);

    const { docTipo, docNro } = resolveDocument(billing.taxId);
    let requested = false;

    // ---------- Pedido a ARCA ----------
    try {
      const cbteNro =
        (await this.arcaClient.lastVoucher(this.ptoVta, cbteTipo)) + 1;
      const today = this.todayInArgentina(); // YYYY-MM-DD

      // Se guarda el número antes de pedirlo: si se corta la conexión, se
      // puede verificar en ARCA si quedó autorizado.
      invoice.cbteNro = cbteNro;
      invoice.cbteFch = today;
      await this.invoicesRepository.save(invoice);

      requested = true;
      const response = await this.arcaClient.createVoucher({
        CantReg: 1,
        PtoVta: this.ptoVta,
        CbteTipo: cbteTipo,
        Concepto: 1, // 1 = Productos
        DocTipo: docTipo,
        DocNro: docNro,
        CbteDesde: cbteNro,
        CbteHasta: cbteNro,
        CbteFch: Number(today.replaceAll('-', '')),
        ImpTotal: calc.totalCents / 100,
        ImpTotConc: 0,
        ImpNeto: calc.netCents / 100,
        ImpOpEx: 0,
        ImpIVA: calc.vatCents / 100,
        ImpTrib: 0,
        MonId: 'PES',
        MonCotiz: 1,
        CondicionIVAReceptorId: billing.taxCondition,
        // La Factura C no discrimina IVA.
        ...(cbteTipo === FACTURA_C
          ? {}
          : {
              Iva: calc.vatByRate.map((v) => ({
                Id: VAT_ID_BY_RATE[String(v.rate)],
                BaseImp: v.baseCents / 100,
                Importe: v.vatCents / 100,
              })),
            }),
      });

      invoice.status = InvoiceStatus.AUTHORIZED;
      invoice.cae = response.CAE;
      invoice.caeVto = response.CAEFchVto;
      await this.invoicesRepository.save(invoice);

      return {
        orderId,
        ok: true,
        invoiceId: invoice.id,
        ptoVta: invoice.ptoVta,
        cbteTipo,
        cbteNro,
        cae: response.CAE,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error desconocido de ARCA';

      if (requested && !isArcaRejection(error)) {
        // No se sabe si ARCA lo autorizó: queda pendiente con su número, y al
        // reintentar se verifica en ARCA antes de pedir otro.
        invoice.errorMessage = message;
        await this.invoicesRepository.save(invoice);

        return {
          orderId,
          ok: false,
          error: `No se pudo confirmar la factura con ARCA (${message}). Volvé a intentar: primero se verifica si quedó emitida.`,
        };
      }

      invoice.status = InvoiceStatus.REJECTED;
      invoice.cbteNro = null;
      invoice.errorMessage = message;
      await this.invoicesRepository.save(invoice);

      return { orderId, ok: false, error: message };
    }
  }

  // Una emisión quedó sin confirmar: se consulta en ARCA si el comprobante
  // existe. Si existe, se completa; si no, se puede volver a pedir.
  private async reconcilePending(invoice: Invoice): Promise<EmitResult | null> {
    if (!invoice.cbteNro) {
      return {
        orderId: invoice.orderId,
        ok: false,
        error:
          'Hay una emisión sin confirmar para esta venta. Verificala en ARCA antes de reintentar',
      };
    }

    let info: Awaited<ReturnType<ArcaClient['voucherInfo']>>;

    try {
      info = await this.arcaClient.voucherInfo(
        invoice.cbteNro,
        invoice.ptoVta,
        invoice.cbteTipo,
      );
    } catch (error) {
      return {
        orderId: invoice.orderId,
        ok: false,
        error: `No se pudo verificar en ARCA la emisión anterior (${error instanceof Error ? error.message : 'error desconocido'}). Probá de nuevo en un rato.`,
      };
    }

    if (!info) return null;

    if (Math.abs(toCents(info.total) - toCents(invoice.total)) > 1) {
      // El número lo usó otro comprobante: el de esta venta no se emitió.
      return null;
    }

    invoice.status = InvoiceStatus.AUTHORIZED;
    invoice.cae = info.cae;
    invoice.caeVto = info.caeVto;
    invoice.errorMessage = null;
    await this.invoicesRepository.save(invoice);

    this.logger.log(
      `Factura ${formatVoucherNumber(invoice.ptoVta, invoice.cbteNro)} recuperada de ARCA`,
    );

    return {
      orderId: invoice.orderId,
      ok: true,
      invoiceId: invoice.id,
      ptoVta: invoice.ptoVta,
      cbteTipo: invoice.cbteTipo,
      cbteNro: invoice.cbteNro,
      cae: info.cae,
    };
  }

  // ---------- PDF y mail ----------

  private async authorizedInvoice(invoiceId: string) {
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

    return invoice;
  }

  async pdf(invoiceId: string) {
    const invoice = await this.authorizedInvoice(invoiceId);
    const sale = await this.loadSale(invoice.orderId);

    // Facturas viejas sin los datos guardados: se usan los del cliente.
    const receiver = invoice.customerName
      ? {
          name: invoice.customerName,
          address: invoice.customerAddress,
          taxId: invoice.taxId ?? null,
          taxCondition: invoice.taxCondition,
        }
      : this.billingFrom(sale.customer);

    const calc = computeInvoice(sale.items, invoice.cbteTipo);

    const data: InvoicePdfData = {
      draft: false,
      cbteTipo: invoice.cbteTipo,
      ptoVta: invoice.ptoVta,
      cbteNro: invoice.cbteNro,
      cbteFch: invoice.cbteFch,
      cae: invoice.cae,
      caeVto: invoice.caeVto,
      receiver,
      ...calc,
      totalCents: toCents(invoice.total),
    };

    return {
      invoice,
      buffer: await this.pdfService.render(data),
      filename: this.pdfService.filename(data),
    };
  }

  // Manda la factura por mail. Si falla, queda registrado el error para
  // reintentar; la factura ya está emitida igual.
  async sendEmail(invoiceId: string, to?: string): Promise<EmailResult> {
    const { invoice, buffer, filename } = await this.pdf(invoiceId);

    let address = to?.trim() || invoice.customerEmail;
    if (!address) {
      const order = await this.ordersRepository.findOne({
        where: { id: invoice.orderId },
      });
      const customer = order
        ? await this.customersRepository.findOne({
            where: { id: order.customerId },
          })
        : null;
      address = customer?.email ?? null;
    }

    if (!address) {
      throw new BadRequestException(
        'El cliente no tiene mail: cargalo para poder enviarle la factura',
      );
    }

    const letter = VOUCHER[invoice.cbteTipo]?.letter ?? '';
    const number = formatVoucherNumber(invoice.ptoVta, invoice.cbteNro!);
    const business = this.arca.business.name || 'Facturación';
    const total = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(Number(invoice.total));

    try {
      await this.mailService.send({
        to: address,
        subject: `Factura ${letter} ${number} - ${business}`,
        text: [
          `Hola${invoice.customerName ? ` ${invoice.customerName}` : ''}:`,
          '',
          `Te enviamos adjunta la factura ${letter} ${number} por ${total}.`,
          '',
          'Gracias por tu compra.',
          business,
        ].join('\n'),
        attachments: [{ filename, content: buffer }],
      });

      await this.invoicesRepository.update(invoice.id, {
        emailedTo: address,
        emailedAt: new Date(),
        emailError: null,
      });

      return { sent: true, to: address };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar el mail';
      this.logger.warn(`No se pudo mandar la factura ${number}: ${message}`);

      await this.invoicesRepository.update(invoice.id, {
        emailedTo: address,
        emailError: message,
      });

      return { sent: false, to: address, error: message };
    }
  }

  private todayInArgentina() {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    });
  }
}
