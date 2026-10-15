import { GmailApiTransport } from './gmail-api.transport.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const message = {
  from: '"DF Achuras" <dfachuras@gmail.com>',
  to: 'cliente@test.com',
  subject: 'Factura A 00003-00000012 - DF Achuras',
  text: 'Te enviamos la factura.',
  attachments: [{ filename: 'factura.pdf', content: Buffer.from('%PDF-1.4') }],
};

describe('envío con la API de Gmail', () => {
  const credentials = {
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
  };

  it('pide acceso con la clave de renovación y manda el mail con el adjunto', async () => {
    const calls: { url: string; init: { body: string; headers: unknown } }[] =
      [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        init: {
          body:
            init.body instanceof URLSearchParams
              ? init.body.toString()
              : (init.body as string),
          headers: init.headers,
        },
      });
      return url.includes('oauth2')
        ? json(200, { access_token: 'token-1', expires_in: 3600 })
        : json(200, { id: 'msg-1' });
    });
    const transport = new GmailApiTransport(credentials, fetchFn as never);

    await transport.sendMail(message);
    await transport.sendMail(message);

    // El acceso se reutiliza mientras no venza.
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    expect(calls[0].init.body).toContain('grant_type=refresh_token');

    const send = calls[1];
    expect(send.url).toContain('/users/me/messages/send');
    expect((send.init.headers as Record<string, string>).authorization).toBe(
      'Bearer token-1',
    );

    const raw = Buffer.from(
      JSON.parse(send.init.body).raw,
      'base64url',
    ).toString();
    expect(raw).toContain('To: cliente@test.com');
    expect(raw).toContain('Factura A 00003-00000012');
    expect(raw).toContain('filename=factura.pdf');
  });

  it('explica qué hacer si la autorización fue revocada', async () => {
    const fetchFn = vi.fn(async () => json(400, { error: 'invalid_grant' }));
    const transport = new GmailApiTransport(credentials, fetchFn as never);

    await expect(transport.sendMail(message)).rejects.toThrow(
      'volvé a correr npm run gmail:authorize',
    );
  });

  it('informa el error de Gmail', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('oauth2')
        ? json(200, { access_token: 't', expires_in: 3600 })
        : json(403, { error: { message: 'Daily sending quota exceeded' } }),
    );
    const transport = new GmailApiTransport(credentials, fetchFn as never);

    await expect(transport.sendMail(message)).rejects.toThrow(
      'Gmail no envió el mail: Daily sending quota exceeded',
    );
  });
});
