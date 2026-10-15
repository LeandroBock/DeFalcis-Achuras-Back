import { existsSync, readFileSync } from 'node:fs';
import Afip from '@afipsdk/afip.js';

import type { ArcaConfig } from '../config/arca.config.js';

export const ARCA_CLIENT = Symbol('ARCA_CLIENT');

export interface ArcaVoucherInfo {
  cae: string;
  caeVto: string; // YYYY-MM-DD
  total: number;
}

// Lo que la facturación necesita de ARCA. En los tests se reemplaza por uno
// falso para no llamar a ARCA.
export interface ArcaClient {
  lastVoucher(ptoVta: number, cbteTipo: number): Promise<number>;
  createVoucher(
    data: Record<string, unknown>,
  ): Promise<{ CAE: string; CAEFchVto: string }>;
  // null si el comprobante no existe en ARCA.
  voucherInfo(
    cbteNro: number,
    ptoVta: number,
    cbteTipo: number,
  ): Promise<ArcaVoucherInfo | null>;
}

// 'YYYYMMDD' -> 'YYYY-MM-DD'
const isoDate = (value: string) =>
  /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value;

export class AfipSdkArcaClient implements ArcaClient {
  private client: any;

  constructor(private readonly arca: ArcaConfig) {}

  // Se crea recién al emitir, así un certificado faltante no tumba el arranque
  private get afip() {
    if (!this.client) {
      const { cuit, production, accessToken, certPath, keyPath } = this.arca;

      if (!cuit) {
        throw new Error('Falta configurar ARCA_CUIT para poder facturar');
      }

      const options: Record<string, unknown> = {
        CUIT: Number(cuit),
        production,
        access_token: accessToken,
      };

      if (certPath && keyPath) {
        if (!existsSync(certPath) || !existsSync(keyPath)) {
          throw new Error(
            `No se encontró el certificado o la clave de ARCA (${certPath}, ${keyPath})`,
          );
        }

        options.cert = readFileSync(certPath, 'utf8');
        options.key = readFileSync(keyPath, 'utf8');
      }

      this.client = new Afip(options as any);
    }

    return this.client;
  }

  async lastVoucher(ptoVta: number, cbteTipo: number) {
    return Number(
      await this.afip.ElectronicBilling.getLastVoucher(ptoVta, cbteTipo),
    );
  }

  createVoucher(data: Record<string, unknown>) {
    return this.afip.ElectronicBilling.createVoucher(data);
  }

  async voucherInfo(cbteNro: number, ptoVta: number, cbteTipo: number) {
    const info = await this.afip.ElectronicBilling.getVoucherInfo(
      cbteNro,
      ptoVta,
      cbteTipo,
    );

    if (!info?.CodAutorizacion) return null;

    return {
      cae: String(info.CodAutorizacion),
      caeVto: isoDate(String(info.FchVto)),
      total: Number(info.ImpTotal),
    };
  }
}
