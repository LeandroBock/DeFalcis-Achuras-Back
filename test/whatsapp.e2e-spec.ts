import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';

import { filter, firstValueFrom } from 'rxjs';

import { UserRole } from '../src/users/entities/user.entity.js';
import {
  clearStoredSession,
  hasStoredSession,
  useDatabaseAuthState,
} from '../src/whatsapp/connection/database-auth-state.js';
import {
  InboundWhatsAppMessage,
  WHATSAPP_CLIENT,
  WhatsAppConnectionStatus,
} from '../src/whatsapp/connection/whatsapp-client.js';
import { WhatsAppAuth } from '../src/whatsapp/entities/whatsapp-auth.entity.js';
import {
  WhatsAppMessage,
  WhatsAppMessageDirection,
  WhatsAppMessageType,
} from '../src/whatsapp/entities/whatsapp-message.entity.js';
import { WhatsAppEventsService } from '../src/whatsapp/whatsapp-events.service.js';
import { WhatsAppInboxService } from '../src/whatsapp/whatsapp-inbox.service.js';

import { FakeWhatsAppClient } from './support/fake-whatsapp-client.js';
import { TestApp, createTestApp } from './support/test-app.js';

let externalIds = 0;
const inboundMessage = (
  overrides: Partial<InboundWhatsAppMessage> = {},
): InboundWhatsAppMessage => ({
  externalMessageId: `IN-${++externalIds}`,
  phone: '5493415556789',
  fromMe: false,
  type: WhatsAppMessageType.TEXT,
  text: 'Hola, quiero 3 kg de chinchulín',
  contactName: 'Juan WhatsApp',
  sentAt: new Date(),
  ...overrides,
});

describe('WhatsApp conectado (cliente simulado)', () => {
  let t: TestApp;
  let fake: FakeWhatsAppClient;
  let inbox: WhatsAppInboxService;
  let events: WhatsAppEventsService;
  let admin: string;
  let ventas: string;

  const messages = () => t.dataSource.getRepository(WhatsAppMessage);

  beforeAll(async () => {
    fake = new FakeWhatsAppClient();
    t = await createTestApp({}, (builder) =>
      builder.overrideProvider(WHATSAPP_CLIENT).useValue(fake),
    );
    inbox = t.app.get(WhatsAppInboxService);
    events = t.app.get(WhatsAppEventsService);
    admin = (await t.createUser(UserRole.ADMIN)).auth;
    ventas = (await t.createUser(UserRole.VENTAS)).auth;
  });

  afterAll(() => t.close());

  beforeEach(() => {
    fake.state = {
      status: WhatsAppConnectionStatus.CONNECTED,
      phone: '5493410000000',
    };
  });

  describe('mensajes que llegan', () => {
    it('se guardan asociados al cliente aunque su teléfono esté en otro formato', async () => {
      const customer = await t.createCustomer({ phone: '0341 15 5556789' });

      const saved = await inbox.receive(inboundMessage());

      expect(saved).toMatchObject({
        phone: '5493415556789',
        direction: WhatsAppMessageDirection.INCOMING,
        customerId: customer.id,
        contactName: 'Juan WhatsApp',
        message: 'Hola, quiero 3 kg de chinchulín',
      });
    });

    it('el mismo mensaje recibido dos veces se guarda una sola vez', async () => {
      const message = inboundMessage({ phone: '5493416660000' });

      expect(await inbox.receive(message)).not.toBeNull();
      expect(await inbox.receive(message)).toBeNull();
      expect(
        await messages().countBy({
          externalMessageId: message.externalMessageId,
        }),
      ).toBe(1);
    });

    it('lo escrito desde el celular del negocio queda como mensaje enviado', async () => {
      const saved = await inbox.receive(
        inboundMessage({ fromMe: true, contactName: undefined }),
      );

      expect(saved).toMatchObject({
        direction: WhatsAppMessageDirection.OUTGOING,
        status: 'sent',
      });
    });

    it('avisa en tiempo real', async () => {
      const next = firstValueFrom(
        events.stream().pipe(filter((event) => event.type === 'message')),
      );

      await inbox.receive(inboundMessage({ text: 'Mensaje en vivo' }));

      expect((await next).data).toMatchObject({ message: 'Mensaje en vivo' });
    });

    it('los mensajes de la conexión se guardan solos', async () => {
      const message = inboundMessage({ text: 'Desde la conexión' });

      events.inbound(message);

      await expect
        .poll(() =>
          messages().countBy({ externalMessageId: message.externalMessageId }),
        )
        .toBe(1);
    });

    it('no responde automáticamente', async () => {
      const before = fake.sent.length;

      await inbox.receive(inboundMessage({ text: 'quiero 2 kg de molleja' }));

      expect(fake.sent.length).toBe(before);
    });
  });

  describe('enviar desde la app', () => {
    const send = (phone: string, message: string, auth = ventas) =>
      t
        .http()
        .post(`/whatsapp/conversations/${phone}/messages`)
        .set('authorization', auth)
        .send({ message });

    it('envía por WhatsApp y guarda el mensaje en la conversación', async () => {
      const res = await send('3415556789', '¿Cuántos kilos querés?').expect(
        201,
      );

      expect(fake.sent.at(-1)).toMatchObject({
        phone: '5493415556789',
        text: '¿Cuántos kilos querés?',
      });
      expect(res.body).toMatchObject({
        phone: '5493415556789',
        direction: WhatsAppMessageDirection.OUTGOING,
        message: '¿Cuántos kilos querés?',
        externalMessageId: fake.sent.at(-1)!.externalMessageId,
      });
    });

    it('el eco de WhatsApp de un mensaje enviado no lo duplica', async () => {
      await send('3415556789', 'Mensaje con eco').expect(201);
      const { externalMessageId } = fake.sent.at(-1)!;

      await inbox.receive(
        inboundMessage({
          externalMessageId,
          fromMe: true,
          text: 'Mensaje con eco',
        }),
      );

      expect(await messages().countBy({ externalMessageId })).toBe(1);
    });

    it('POST /whatsapp/messages/outgoing también envía de verdad', async () => {
      await t
        .http()
        .post('/whatsapp/messages/outgoing')
        .set('authorization', ventas)
        .send({ phone: '3415556789', message: 'Por el endpoint viejo' })
        .expect(201);

      expect(fake.sent.at(-1)?.text).toBe('Por el endpoint viejo');
    });

    it('si WhatsApp está desconectado devuelve 503 y no guarda nada', async () => {
      fake.state = { status: WhatsAppConnectionStatus.DISCONNECTED };
      const before = await messages().count();

      const res = await send('3415556789', 'No sale').expect(503);

      expect(res.body.message).toContain('WhatsApp no está conectado');
      expect(await messages().count()).toBe(before);
    });

    it('rechaza mensajes vacíos', async () => {
      await send('3415556789', '').expect(400);
    });
  });

  describe('conversaciones', () => {
    it('muestran el cliente y el nombre de WhatsApp', async () => {
      const customer = await t.createCustomer({
        name: 'Carnicería El Toro',
        phone: '351 444-5555',
      });
      await inbox.receive(
        inboundMessage({ phone: '5493514445555', contactName: 'Toro' }),
      );

      const res = await t
        .http()
        .get('/whatsapp/conversations')
        .set('authorization', ventas)
        .expect(200);

      expect(
        res.body.find((c: { phone: string }) => c.phone === '5493514445555'),
      ).toMatchObject({
        customerId: customer.id,
        customerName: 'Carnicería El Toro',
        contactName: 'Toro',
        lastMessageDirection: 'incoming',
      });
    });

    it('un número sin cliente muestra el nombre de WhatsApp', async () => {
      await inbox.receive(
        inboundMessage({ phone: '5491177778888', contactName: 'María' }),
      );

      const res = await t
        .http()
        .get('/whatsapp/conversations')
        .set('authorization', ventas);

      expect(
        res.body.find((c: { phone: string }) => c.phone === '5491177778888'),
      ).toMatchObject({
        customerId: null,
        customerName: 'Cliente desconocido',
        contactName: 'María',
      });
    });

    it('del chat se prepara y confirma un pedido', async () => {
      const customer = await t.createCustomer({ phone: '3412223333' });
      const product = await t.createProduct({ name: 'Molleja', stock: 10 });

      const prepared = await t
        .http()
        .post('/whatsapp/orders/prepare')
        .set('authorization', ventas)
        .send({ phone: '5493412223333', message: 'quiero 2 kg de molleja' })
        .expect(201);

      expect(prepared.body.order.customerId).toBe(customer.id);

      await t
        .http()
        .post(`/whatsapp/orders/${prepared.body.order.id}/confirm`)
        .set('authorization', ventas)
        .expect(201);

      expect(await t.stockOf(product.id)).toBe(8);
    });
  });

  describe('conexión', () => {
    const connection = (auth = admin) =>
      t.http().get('/whatsapp/connection').set('authorization', auth);

    it('muestra el estado y el número vinculado', async () => {
      const res = await connection().expect(200);

      expect(res.body).toEqual({
        status: 'connected',
        phone: '5493410000000',
        qr: null,
      });
    });

    it('al conectar devuelve el QR como imagen', async () => {
      const res = await t
        .http()
        .post('/whatsapp/connection/connect')
        .set('authorization', admin)
        .expect(201);

      expect(res.body.status).toBe('waiting_qr');
      expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
    });

    it('se puede desvincular', async () => {
      const res = await t
        .http()
        .post('/whatsapp/connection/logout')
        .set('authorization', admin)
        .expect(201);

      expect(res.body.status).toBe('disconnected');
    });

    it('solo los administradores ven el QR', async () => {
      await connection(ventas).expect(403);
    });
  });

  describe('eventos en tiempo real (SSE)', () => {
    // Abre el stream, espera el primer evento y lo cierra.
    const openEvents = (path: string) =>
      new Promise<{ status: number; type?: string; first: string }>(
        (resolve, reject) => {
          const { port } = t.app.getHttpServer().address() as AddressInfo;
          const req = httpRequest({ port, path }, (res) => {
            if (res.statusCode !== 200) {
              res.resume();
              resolve({ status: res.statusCode!, first: '' });
              return;
            }
            let received = '';
            res.on('data', (chunk: Buffer) => {
              received += chunk.toString();
              if (!received.includes('\n\n', received.indexOf('event:'))) {
                return;
              }
              resolve({
                status: 200,
                type: res.headers['content-type'],
                first: received,
              });
              req.destroy();
            });
          });
          req.on('error', reject);
          req.end();
        },
      );

    it('sin token devuelve 401', async () => {
      expect((await openEvents('/whatsapp/events')).status).toBe(401);
    });

    it('con ?access_token= abre el stream y manda el estado de conexión', async () => {
      const token = ventas.replace('Bearer ', '');

      const res = await openEvents(`/whatsapp/events?access_token=${token}`);

      expect(res.status).toBe(200);
      expect(res.type).toContain('text/event-stream');
      expect(res.first).toContain('event: connection');
      expect(res.first).not.toContain('qr');
    });

    it('el token por URL no sirve en el resto de la API', async () => {
      const token = ventas.replace('Bearer ', '');

      await t.http().get(`/orders?access_token=${token}`).expect(401);
    });
  });

  describe('sesión guardada en la base', () => {
    it('credenciales y claves sobreviven a un reinicio', async () => {
      const repository = t.dataSource.getRepository(WhatsAppAuth);
      await clearStoredSession(repository);

      const first = await useDatabaseAuthState(repository);
      first.state.creds.me = { id: '5493410000000:1@s.whatsapp.net' };
      await first.saveCreds();
      await first.state.keys.set({
        'pre-key': {
          '1': { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5]) },
        },
      });

      expect(await hasStoredSession(repository)).toBe(true);

      // "Reinicio": se vuelve a leer todo desde la base.
      const second = await useDatabaseAuthState(repository);
      expect(second.state.creds.me?.id).toBe('5493410000000:1@s.whatsapp.net');
      expect(second.state.creds.noiseKey.private).toEqual(
        first.state.creds.noiseKey.private,
      );

      const keys = await second.state.keys.get('pre-key', ['1', '2']);
      expect(Buffer.from(keys['1'].public)).toEqual(Buffer.from([1, 2, 3]));
      expect(keys['2']).toBeUndefined();

      await second.state.keys.set({ 'pre-key': { '1': null } });
      expect(await second.state.keys.get('pre-key', ['1'])).toEqual({});

      await clearStoredSession(repository);
      expect(await hasStoredSession(repository)).toBe(false);
    });
  });
});
