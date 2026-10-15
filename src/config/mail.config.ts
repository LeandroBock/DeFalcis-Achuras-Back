import { ConfigType, registerAs } from '@nestjs/config';

// Correo desde el que salen las facturas. Con Gmail: SMTP_USER es la cuenta y
// SMTP_PASS una "contraseña de aplicación" de Google (no la contraseña normal).
export const mailConfig = registerAs('mail', () => ({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER ?? '',
  pass: process.env.SMTP_PASS ?? '',
  // Si no se define, sale con el nombre del negocio y la cuenta SMTP_USER.
  from: process.env.MAIL_FROM ?? '',
}));

export type MailConfig = ConfigType<typeof mailConfig>;
