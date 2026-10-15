import { Inject, Injectable, Logger } from '@nestjs/common';

import { mailConfig } from '../config/mail.config.js';
import type { MailConfig } from '../config/mail.config.js';
import { arcaConfig } from '../config/arca.config.js';
import type { ArcaConfig } from '../config/arca.config.js';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}

// Lo mínimo que se usa de nodemailer. En los tests se reemplaza por uno falso.
export interface MailTransport {
  sendMail(message: MailMessage & { from: string }): Promise<unknown>;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(mailConfig.KEY) private readonly mail: MailConfig,
    @Inject(arcaConfig.KEY) private readonly arca: ArcaConfig,
  ) {}

  get isConfigured() {
    return this.transport !== null;
  }

  async send(message: MailMessage) {
    if (!this.transport) {
      throw new Error(
        'El correo no está configurado (faltan SMTP_USER y SMTP_PASS)',
      );
    }

    const name = (this.arca.business.name || 'Facturación').replace(/"/g, '');
    const from = this.mail.from || `"${name}" <${this.mail.user}>`;

    await this.transport.sendMail({ ...message, from });
    this.logger.log(`Mail enviado a ${message.to}: ${message.subject}`);
  }
}
