import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import nodemailer from 'nodemailer';

import { mailConfig } from '../config/mail.config.js';
import type { MailConfig } from '../config/mail.config.js';
import { MAIL_TRANSPORT, MailService } from './mail.service.js';
import { GmailApiTransport } from './gmail-api.transport.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [mailConfig.KEY],
      // Sin credenciales no hay correo: las facturas se emiten igual y el
      // envío queda pendiente para reenviar.
      useFactory: (mail: MailConfig) => {
        const { gmail } = mail;

        if (gmail.clientId && gmail.clientSecret && gmail.refreshToken) {
          return new GmailApiTransport(gmail);
        }

        return mail.user && mail.pass
          ? nodemailer.createTransport({
              host: mail.host,
              port: mail.port,
              secure: mail.port === 465,
              auth: { user: mail.user, pass: mail.pass },
            })
          : null;
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
