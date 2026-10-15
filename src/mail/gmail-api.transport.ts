import nodemailer from 'nodemailer';

import type { MailMessage, MailTransport } from './mail.service.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

// Manda el mail con la API de Gmail (HTTPS): sale de la cuenta autorizada y
// queda en "Enviados". El mensaje se arma con nodemailer (adjuntos incluidos).
export class GmailApiTransport implements MailTransport {
  private accessToken: string | null = null;
  private expiresAt = 0;

  private readonly composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });

  constructor(
    private readonly credentials: GmailCredentials,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async token() {
    if (this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken;
    }

    const response = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (!response.ok || !data.access_token) {
      throw new Error(
        data.error === 'invalid_grant'
          ? 'La autorización de Gmail venció o fue revocada: volvé a correr npm run gmail:authorize'
          : `Google no dio acceso a Gmail (${data.error ?? response.status})`,
      );
    }

    this.accessToken = data.access_token;
    // Un minuto de margen antes de que venza.
    this.expiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
    return this.accessToken;
  }

  async sendMail(message: MailMessage & { from: string }) {
    const { message: raw } = (await this.composer.sendMail(message)) as {
      message: Buffer;
    };

    const response = await this.fetchFn(SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.token()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ raw: raw.toString('base64url') }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (response.status === 401) this.accessToken = null;
      throw new Error(
        `Gmail no envió el mail: ${data.error?.message ?? response.status}`,
      );
    }

    return response.json();
  }
}
