import {
  WhatsAppClient,
  WhatsAppConnectionState,
  WhatsAppConnectionStatus,
  notConnected,
} from '../../src/whatsapp/connection/whatsapp-client.js';
import { toWhatsAppNumber } from '../../src/whatsapp/whatsapp-phone.js';

// Reemplaza la conexión real con WhatsApp en los tests: registra lo que se
// "envía" y permite simular el estado de la conexión.
export class FakeWhatsAppClient implements WhatsAppClient {
  state: WhatsAppConnectionState = {
    status: WhatsAppConnectionStatus.CONNECTED,
    phone: '5493410000000',
  };

  readonly sent: { phone: string; text: string; externalMessageId: string }[] =
    [];

  getState() {
    return this.state;
  }

  connect() {
    this.state = {
      status: WhatsAppConnectionStatus.WAITING_QR,
      qr: '2@codigo-qr-de-prueba',
    };
    return Promise.resolve();
  }

  logout() {
    this.state = { status: WhatsAppConnectionStatus.DISCONNECTED };
    return Promise.resolve();
  }

  sendText(phone: string, text: string) {
    if (this.state.status !== WhatsAppConnectionStatus.CONNECTED) {
      return Promise.reject(notConnected());
    }

    const sent = {
      phone: toWhatsAppNumber(phone),
      text,
      externalMessageId: `FAKE-${this.sent.length + 1}`,
    };
    this.sent.push(sent);

    return Promise.resolve({
      externalMessageId: sent.externalMessageId,
      phone: sent.phone,
    });
  }
}
