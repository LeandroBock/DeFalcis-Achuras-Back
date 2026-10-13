import { inflateSync } from 'node:zlib';

import {
  Invoice,
  InvoiceStatus,
} from '../src/invoicing/entities/invoice.entity.js';
import { UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

// Extrae el texto visible de un PDF generado por pdfkit: descomprime cada
// stream y decodifica los textos en hexadecimal de los operadores TJ.
function pdfText(pdf: Buffer) {
  const raw = pdf.toString('latin1');
  const streams = raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g);
  let text = '';

  for (const [, content] of streams) {
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

describe('Facturación', () => {
  let t: TestApp;
  let auth: string;

  beforeAll(async () => {
    t = await createTestApp({
      ARCA_PRODUCTION: 'false',
      ARCA_CUIT: '20111111112',
      ARCA_PTO_VTA: '7',
      ARCA_CERT_PATH: '',
      ARCA_KEY_PATH: '',
      ARCA_BUSINESS_NAME: 'Achuras de Prueba SRL',
      ARCA_BUSINESS_ADDRESS: 'Av. Siempreviva 742',
      ARCA_IVA_CONDITION: 'IVA Responsable Inscripto',
      ARCA_IIBB: '901-123456-7',
      ARCA_ACTIVITY_START: '01/03/2020',
    });
    auth = (await t.createUser(UserRole.FINANZAS)).auth;
  });

  afterAll(() => t.close());

  const authorizedInvoice = async () => {
    const admin = (await t.createUser(UserRole.ADMIN)).auth;
    const customer = await t.createCustomer();
    const product = await t.createProduct({ name: 'Chinchulín' });

    const order = await t
      .http()
      .post('/orders')
      .set('authorization', admin)
      .send({
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 2 }],
      })
      .expect(201);

    const repository = t.dataSource.getRepository(Invoice);

    return repository.save(
      repository.create({
        orderId: order.body.order.id,
        ptoVta: 7,
        cbteTipo: 6,
        cbteNro: 123,
        status: InvoiceStatus.AUTHORIZED,
        cae: '74123456789012',
        caeVto: '2026-12-31',
        cbteFch: '2026-10-13',
        total: 2000,
      }),
    );
  };

  it('el PDF incluye los datos del emisor configurados', async () => {
    const invoice = await authorizedInvoice();

    const res = await t
      .http()
      .get(`/invoicing/${invoice.id}/pdf`)
      .set('authorization', auth)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');

    const text = pdfText(res.body);
    expect(text).toContain('Achuras de Prueba SRL');
    expect(text).toContain('Av. Siempreviva 742');
    expect(text).toContain('20111111112');
    expect(text).toContain('901-123456-7');
    expect(text).toContain('00007-00000123');
    expect(text).toContain('Chinchulín');
  });

  it('no genera el PDF de una factura sin autorizar', async () => {
    const invoice = await authorizedInvoice();
    await t.dataSource
      .getRepository(Invoice)
      .update(invoice.id, { status: InvoiceStatus.PENDING });

    await t
      .http()
      .get(`/invoicing/${invoice.id}/pdf`)
      .set('authorization', auth)
      .expect(400);
  });
});
