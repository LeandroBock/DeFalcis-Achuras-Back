import { ConfigType, registerAs } from '@nestjs/config';

// Configuración de facturación electrónica (ARCA / AFIP SDK). Se valida al
// arrancar en env.validation.ts.
export const arcaConfig = registerAs('arca', () => ({
  cuit: process.env.ARCA_CUIT ?? '',
  production: process.env.ARCA_PRODUCTION === 'true',
  pointOfSale: Number(process.env.ARCA_PTO_VTA || 1),
  accessToken: process.env.AFIPSDK_ACCESS_TOKEN ?? '',
  certPath: process.env.ARCA_CERT_PATH || undefined,
  keyPath: process.env.ARCA_KEY_PATH || undefined,

  // Datos del emisor impresos en el PDF de la factura.
  business: {
    name: process.env.ARCA_BUSINESS_NAME ?? '',
    address: process.env.ARCA_BUSINESS_ADDRESS ?? '',
    ivaCondition: process.env.ARCA_IVA_CONDITION ?? '',
    iibb: process.env.ARCA_IIBB ?? '',
    activityStart: process.env.ARCA_ACTIVITY_START ?? '',
  },
}));

export type ArcaConfig = ConfigType<typeof arcaConfig>;
