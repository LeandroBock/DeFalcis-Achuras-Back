import { inflateSync } from 'node:zlib';

import { Customer } from '../src/customers/entities/customer.entity.js';
import {
  Invoice,
  InvoiceStatus,
} from '../src/invoicing/entities/invoice.entity.js';
import { ARCA_CLIENT } from '../src/invoicing/arca-client.js';
import type { ArcaClient } from '../src/invoicing/arca-client.js';
import { MAIL_TRANSPORT } from '../src/mail/mail.service.js';
import type { MailTransport } from '../src/mail/mail.service.js';
import { UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

function pdfText(pdf: Buffer) {
  const raw = pdf.toString('latin1');
  let text = '';

  for (const [, content] of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let decoded: string;
    try {
      decoded = inflateSync(Buffer.from(content, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const [, hex] of decoded.matchAll(/<([0-9a-fA-F]+)>/g)) {
      text += Buffer.from(hex, 'hex').toString('latin1');
    }
    text += '\n';
  }

  return text;
}

// ARCA falso: numera correlativo y se le puede pedir que falle.
class FakeArca implements ArcaClient {
  last = 0;
  created: Record<string, unknown>[] = [];
  vouchers = new Map<number, { cae: string; total: number }>();
  failNext: 'reject' | 'network' | null = null;

  async lastVoucher() {
    return this.last;
  }

  async createVoucher(data: Record<string, unknown>) {
    if (this.failNext === 'reject') {
      this.failNext = null;
      class AfipWebServiceError extends Error {}
      throw new AfipWebServiceError('(10015) El documento no es válido');
    }

    const nro = Number(data.CbteDesde);
    const cae = `7400000000${String(nro).padStart(4, '0')}`;
    this.created.push(data);
    this.vouchers.set(nro, { cae, total: Number(data.ImpTotal) });
    this.last = nro;

    // Corte de red: ARCA lo autorizó pero la respuesta no llegó.
    if (this.failNext === 'network') {
      this.failNext = null;
      throw new Error('socket hang up');
    }

    return { CAE: cae, CAEFchVto: '2026-10-24' };
  }

  async voucherInfo(nro: number) {
    const voucher = this.vouchers.get(nro);
    return voucher
      ? { cae: voucher.cae, caeVto: '2026-10-24', total: voucher.total }
      : null;
  }
}

class FakeMail implements MailTransport {
  sent: Parameters<MailTransport['sendMail']>[0][] = [];
  fail = false;

  async sendMail(message: Parameters<MailTransport['sendMail']>[0]) {
    if (this.fail) throw new Error('Invalid login');
    this.sent.push(message);
  }
}

const binary = (res: any, callback: (err: null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('Facturación con revisión previa', () => {
  let t: TestApp;
  let arca: FakeArca;
  let mail: FakeMail;
  let auth: string;
  let office: Awaited<ReturnType<TestApp['createUser']>>;
  let driver: Awaited<ReturnType<TestApp['createUser']>>;

  beforeAll(async () => {
    arca = new FakeArca();
    mail = new FakeMail();
    t = await createTestApp(
      {
        ARCA_PRODUCTION: 'false',
        ARCA_CUIT: '20111111112',
        ARCA_PTO_VTA: '3',
        ARCA_CERT_PATH: '',
        ARCA_KEY_PATH: '',
        ARCA_BUSINESS_NAME: 'DF Achuras SRL',
        ARCA_BUSINESS_ADDRESS: 'Ruta 9 km 300',
        ARCA_IVA_CONDITION: 'IVA Responsable Inscripto',
      },
      (builder) =>
        builder
          .overrideProvider(ARCA_CLIENT)
          .useValue(arca)
          .overrideProvider(MAIL_TRANSPORT)
          .useValue(mail),
    );
    auth = (await t.createUser(UserRole.FINANZAS)).auth;
    office = await t.createUser(UserRole.VENTAS);
    driver = await t.createUser(UserRole.REPARTO);
  });

  afterAll(() => t.close());

  // Venta entregada de 2 kg a $1000 (IVA 10,5%).
  const deliveredSale = async (customer: Partial<Customer> = {}) => {
    const client = await t.createCustomer({
      name: 'Carnicería Centro',
      email: 'centro@test.com',
      ...customer,
    });
    const product = await t.createProduct({
      name: 'Chinchulín',
      salePrice: 1000,
      stock: 100,
      vatRate: 10.5,
    });
    const note = await t
      .http()
      .post('/orders')
      .set('authorization', office.auth)
      .send({
        customerId: client.id,
        items: [{ productId: product.id, quantity: 2 }],
        assignedToId: driver.user.id,
      })
      .expect(201);
    await t
      .http()
      .post(`/orders/${note.body.order.id}/deliver`)
      .set('authorization', driver.auth)
      .send({ items: [{ productId: product.id, quantity: 2 }] })
      .expect(201);

    return { customer: client, orderId: note.body.order.id as string };
  };

  const preview = (orderId: string, customer?: Record<string, unknown>) =>
    t
      .http()
      .post('/invoicing/preview')
      .set('authorization', auth)
      .send({ orderId, customer });

  const emit = (body: Record<string, unknown>) =>
    t.http().post('/invoicing/emit').set('authorization', auth).send(body);

  it('la vista previa muestra los datos del cliente y el tipo de factura', async () => {
    const { orderId } = await deliveredSale({
      address: 'San Martín 123',
      taxCondition: 5,
    });

    const res = await preview(orderId).expect(200);

    expect(res.body).toMatchObject({
      customer: {
        name: 'Carnicería Centro',
        email: 'centro@test.com',
        address: 'San Martín 123',
        taxCondition: 5,
      },
      letter: 'B',
      total: 2000,
      problems: [],
      emailConfigured: true,
    });
    expect(res.body.vat).toBeCloseTo(190.05, 2);
  });

  it('avisa los datos que impiden emitir (CUIT inválido para Factura A)', async () => {
    const { orderId } = await deliveredSale();

    const res = await preview(orderId, {
      name: 'Carnicería Centro',
      taxId: '20-11111111-3',
      taxCondition: 1,
    }).expect(200);

    expect(res.body.letter).toBe('A');
    expect(res.body.problems).toContain(
      'El CUIT no es válido: revisá los números',
    );

    const emitted = await emit({
      orderId,
      customer: { name: 'Carnicería Centro', taxId: '2011', taxCondition: 1 },
    }).expect(201);
    expect(emitted.body.ok).toBe(false);
    expect(arca.created).toHaveLength(0);
  });

  it('el borrador en PDF se puede descargar antes de emitir', async () => {
    const { orderId } = await deliveredSale();

    const res = await t
      .http()
      .post('/invoicing/preview/pdf')
      .set('authorization', auth)
      .send({
        orderId,
        customer: { name: 'Nombre Corregido SA', taxCondition: 5 },
      })
      .buffer(true)
      .parse(binary)
      .expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    const text = pdfText(res.body);
    expect(text).toContain('BORRADOR - SIN VALIDEZ FISCAL');
    expect(text).toContain('Nombre Corregido SA');
  });

  it('emite con los datos corregidos, los guarda en el cliente y manda el mail', async () => {
    const { orderId, customer } = await deliveredSale({ email: undefined });
    mail.sent = [];

    const res = await emit({
      orderId,
      customer: {
        name: 'Carnicería Centro SRL',
        taxId: '20-11111111-2',
        taxCondition: 1,
        address: 'Belgrano 55',
        email: 'compras@centro.com',
      },
    }).expect(201);

    expect(res.body).toMatchObject({
      ok: true,
      ptoVta: 3,
      cbteTipo: 1,
      email: { sent: true, to: 'compras@centro.com' },
    });

    const voucher = arca.created.at(-1)!;
    expect(voucher).toMatchObject({
      PtoVta: 3,
      CbteTipo: 1,
      DocTipo: 80,
      DocNro: 20111111112,
      ImpTotal: 2000,
      CondicionIVAReceptorId: 1,
    });
    expect(voucher.Iva).toEqual([{ Id: 4, BaseImp: 1809.95, Importe: 190.05 }]);

    const saved = await t.dataSource
      .getRepository(Customer)
      .findOneByOrFail({ id: customer.id });
    expect(saved).toMatchObject({
      name: 'Carnicería Centro SRL',
      taxId: '20111111112',
      taxCondition: 1,
      address: 'Belgrano 55',
      email: 'compras@centro.com',
    });

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      to: 'compras@centro.com',
      from: '"DF Achuras SRL" <>',
    });
    expect(mail.sent[0].subject).toMatch(
      /^Factura A 00003-\d{8} - DF Achuras SRL$/,
    );
    expect(mail.sent[0].attachments![0].filename).toMatch(/\.pdf$/);

    const invoice = await t.dataSource
      .getRepository(Invoice)
      .findOneByOrFail({ id: res.body.invoiceId });
    expect(invoice.emailedTo).toBe('compras@centro.com');
    expect(invoice.emailedAt).not.toBeNull();

    // Si después se edita el cliente, la factura no cambia.
    await t.dataSource
      .getRepository(Customer)
      .update(customer.id, { name: 'Otro Nombre' });
    const pdf = await t
      .http()
      .get(`/invoicing/${invoice.id}/pdf`)
      .set('authorization', auth)
      .buffer(true)
      .parse(binary)
      .expect(200);
    const text = pdfText(pdf.body);
    expect(text).toContain('Carnicería Centro SRL');
    expect(text).not.toContain('Otro Nombre');
  });

  it('no factura dos veces la misma venta', async () => {
    const { orderId } = await deliveredSale();
    const customer = { name: 'Carnicería Centro', taxCondition: 5 };

    expect((await emit({ orderId, customer }).expect(201)).body.ok).toBe(true);
    const again = await emit({ orderId, customer }).expect(201);
    expect(again.body).toMatchObject({
      ok: false,
      error: 'La venta ya tiene factura',
    });
  });

  it('si ARCA la rechaza queda rechazada y se puede reintentar', async () => {
    const { orderId } = await deliveredSale();
    const customer = { name: 'Carnicería Centro', taxCondition: 5 };
    arca.failNext = 'reject';

    const res = await emit({ orderId, customer }).expect(201);
    expect(res.body).toMatchObject({ ok: false });
    expect(res.body.error).toContain('10015');

    const invoice = await t.dataSource
      .getRepository(Invoice)
      .findOneByOrFail({ orderId });
    expect(invoice.status).toBe(InvoiceStatus.REJECTED);

    expect((await emit({ orderId, customer }).expect(201)).body.ok).toBe(true);
  });

  it('si se corta la conexión, al reintentar recupera la factura de ARCA sin duplicarla', async () => {
    const { orderId } = await deliveredSale();
    const customer = { name: 'Carnicería Centro', taxCondition: 5 };
    arca.failNext = 'network';

    const first = await emit({ orderId, customer }).expect(201);
    expect(first.body.ok).toBe(false);
    expect(first.body.error).toContain('No se pudo confirmar');

    const pending = await t.dataSource
      .getRepository(Invoice)
      .findOneByOrFail({ orderId });
    expect(pending.status).toBe(InvoiceStatus.PENDING);
    expect(pending.cbteNro).toBe(arca.last);

    const created = arca.created.length;
    const retry = await emit({ orderId, customer }).expect(201);

    expect(retry.body).toMatchObject({ ok: true, cbteNro: pending.cbteNro });
    expect(arca.created).toHaveLength(created);
  });

  it('si el mail falla, la factura queda emitida y se puede reenviar', async () => {
    const { orderId } = await deliveredSale();
    mail.fail = true;

    const res = await emit({
      orderId,
      customer: {
        name: 'Carnicería Centro',
        taxCondition: 5,
        email: 'centro@test.com',
      },
    }).expect(201);

    expect(res.body).toMatchObject({
      ok: true,
      email: { sent: false, error: 'Invalid login' },
    });

    mail.fail = false;
    mail.sent = [];
    const resend = await t
      .http()
      .post(`/invoicing/${res.body.invoiceId}/email`)
      .set('authorization', auth)
      .send({ to: 'otro@test.com' })
      .expect(200);

    expect(resend.body).toEqual({ sent: true, to: 'otro@test.com' });
    expect(mail.sent[0].to).toBe('otro@test.com');

    const invoice = await t.dataSource
      .getRepository(Invoice)
      .findOneByOrFail({ id: res.body.invoiceId });
    expect(invoice.emailError).toBeNull();
  });

  it('ventas no puede facturar', async () => {
    const { orderId } = await deliveredSale();
    await t
      .http()
      .post('/invoicing/preview')
      .set('authorization', office.auth)
      .send({ orderId })
      .expect(403);
  });
});
