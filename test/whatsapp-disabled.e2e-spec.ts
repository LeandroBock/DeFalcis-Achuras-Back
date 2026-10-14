import { UserRole } from '../src/users/entities/user.entity.js';

import { TestApp, createTestApp } from './support/test-app.js';

// En un archivo aparte: cada archivo de tests levanta una sola app.
describe('WhatsApp deshabilitado (WHATSAPP_ENABLED=false)', () => {
  let t: TestApp;
  let admin: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = (await t.createUser(UserRole.ADMIN)).auth;
  });

  afterAll(() => t.close());

  it('informa el estado y no permite conectar ni enviar', async () => {
    const status = await t
      .http()
      .get('/whatsapp/connection')
      .set('authorization', admin)
      .expect(200);
    expect(status.body.status).toBe('disabled');

    await t
      .http()
      .post('/whatsapp/connection/connect')
      .set('authorization', admin)
      .expect(503);

    await t
      .http()
      .post('/whatsapp/conversations/3415556789/messages')
      .set('authorization', admin)
      .send({ message: 'hola' })
      .expect(503);
  });

  it('las conversaciones guardadas se siguen viendo', async () => {
    await t
      .http()
      .get('/whatsapp/conversations')
      .set('authorization', admin)
      .expect(200);
  });
});
