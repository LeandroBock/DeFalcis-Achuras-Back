// Autoriza una vez a la app a mandar mails desde la cuenta de Gmail de la
// empresa (permiso "solo enviar") y muestra las variables para Render.
//
//   npm run gmail:authorize
//
// Pide el Client ID y el Client Secret del proyecto de Google Cloud (tipo
// "App de escritorio"), abre el navegador para aceptar el permiso y manda un
// mail de prueba a la misma casilla.
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const rl = createInterface({ input, output });
const email = (await rl.question('Gmail de la empresa: ')).trim();
const clientId = (await rl.question('Client ID: ')).trim();
const clientSecret = (await rl.question('Client Secret: ')).trim();
rl.close();

if (!email || !clientId || !clientSecret) {
  console.error('Faltan datos. Volvé a correrlo.');
  process.exit(1);
}

// Google redirige a este servidor local con el código de autorización.
const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const value = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      value
        ? '<h2>Listo: ya podés cerrar esta pestaña y volver a la terminal.</h2>'
        : `<h2>No se autorizó (${error}). Volvé a la terminal.</h2>`,
    );
    server.close();
    value ? resolve(value) : reject(new Error(`Google respondió: ${error}`));
  });

  server.listen(0, '127.0.0.1', () => {
    const redirectUri = `http://127.0.0.1:${server.address().port}`;
    server.redirectUri = redirectUri;

    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        login_hint: email,
      });

    console.log(
      `\nAbrí este link (si no se abrió solo) y entrá con ${email}:\n\n${authUrl}\n`,
    );
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'start ""'
          : 'xdg-open';
    exec(`${opener} "${authUrl}"`);
  });

  globalThis.redirectServer = server;
});

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: globalThis.redirectServer.redirectUri,
    grant_type: 'authorization_code',
  }),
});
const tokens = await tokenResponse.json();

if (!tokens.refresh_token) {
  console.error('Google no devolvió la clave de renovación:', tokens);
  process.exit(1);
}

// Mail de prueba a la misma casilla.
const raw = [
  `From: ${email}`,
  `To: ${email}`,
  'Subject: =?UTF-8?B?' +
    Buffer.from('Prueba: la app ya puede mandar facturas').toString('base64') +
    '?=',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'Si te llegó este mail, el envío de facturas por Gmail quedó configurado.',
].join('\r\n');

const sendResponse = await fetch(
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }),
  },
);

console.log(
  sendResponse.ok
    ? `\n✅ Mail de prueba enviado a ${email}.`
    : `\n⚠️  La autorización salió bien pero el mail de prueba falló (${sendResponse.status}).`,
);

console.log(`
Cargá estas variables en Render (Environment) y guardá:

GMAIL_USER=${email}
GMAIL_CLIENT_ID=${clientId}
GMAIL_CLIENT_SECRET=${clientSecret}
GMAIL_REFRESH_TOKEN=${tokens.refresh_token}

No las compartas: permiten mandar mails desde esa cuenta.
`);
