import { ConfigType, registerAs } from '@nestjs/config';

// Correo desde el que salen las facturas. Dos formas:
// - API de Gmail (recomendada, funciona en Render gratis): GMAIL_USER y las
//   credenciales OAuth que genera `npm run gmail:authorize`.
// - SMTP (Render la bloquea en el plan gratuito): SMTP_USER y SMTP_PASS.
export const mailConfig = registerAs('mail', () => ({
  gmail: {
    user: process.env.GMAIL_USER ?? '',
    clientId: process.env.GMAIL_CLIENT_ID ?? '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET ?? '',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN ?? '',
  },
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER ?? '',
  pass: process.env.SMTP_PASS ?? '',
  // Si no se define, sale con el nombre del negocio y la cuenta configurada.
  from: process.env.MAIL_FROM ?? '',
}));

export type MailConfig = ConfigType<typeof mailConfig>;
