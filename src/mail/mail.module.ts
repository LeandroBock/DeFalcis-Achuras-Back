import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import nodemailer from 'nodemailer';

import { mailConfig } from '../config/mail.config.js';
import type { MailConfig } from '../config/mail.config.js';
import { MAIL_TRANSPORT, MailService } from './mail.service.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [mailConfig.KEY],
      // Sin usuario y contraseña no hay correo: las facturas se emiten igual
      // y el envío queda pendiente.
      useFactory: (mail: MailConfig) =>
        mail.user && mail.pass
          ? nodemailer.createTransport({
              host: mail.host,
              port: mail.port,
              secure: mail.port === 465,
              auth: { user: mail.user, pass: mail.pass },
            })
          : null,
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
