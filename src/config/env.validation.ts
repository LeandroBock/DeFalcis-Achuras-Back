import { existsSync } from 'node:fs';

const REQUIRED_VARS = [
  'DB_HOST',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
] as const;

// Obligatorias solo para facturar en producción (ARCA_PRODUCTION=true).
const REQUIRED_ARCA_PRODUCTION_VARS = [
  'ARCA_CUIT',
  'ARCA_PTO_VTA',
  'ARCA_CERT_PATH',
  'ARCA_KEY_PATH',
  'AFIPSDK_ACCESS_TOKEN',
  'ARCA_BUSINESS_NAME',
  'ARCA_BUSINESS_ADDRESS',
  'ARCA_IVA_CONDITION',
] as const;

const MIN_JWT_SECRET_LENGTH = 32;

// Corta el arranque si falta configuración crítica, en lugar de levantar la
// app con valores vacíos (por ejemplo, firmando tokens sin secreto).
export function validateEnv(config: Record<string, unknown>) {
  const errors: string[] = [];

  for (const key of REQUIRED_VARS) {
    if (!config[key]) {
      errors.push(`Falta la variable de entorno ${key}`);
    }
  }

  const jwtSecret = config.JWT_SECRET;

  if (
    typeof jwtSecret === 'string' &&
    jwtSecret.length < MIN_JWT_SECRET_LENGTH
  ) {
    errors.push(
      `JWT_SECRET debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres (generá uno con: openssl rand -base64 48)`,
    );
  }

  if (config.NODE_ENV === 'production' && !config.CORS_ORIGINS) {
    errors.push(
      'En producción hay que definir CORS_ORIGINS (dominios del frontend separados por coma)',
    );
  }

  const whatsappEnabled = config.WHATSAPP_ENABLED;
  if (
    whatsappEnabled !== undefined &&
    whatsappEnabled !== '' &&
    whatsappEnabled !== 'true' &&
    whatsappEnabled !== 'false'
  ) {
    errors.push('WHATSAPP_ENABLED debe ser true o false');
  }

  const sessionHoursValue = config.SESSION_HOURS;
  if (
    sessionHoursValue !== undefined &&
    sessionHoursValue !== '' &&
    !(Number(sessionHoursValue) > 0 && Number(sessionHoursValue) <= 168)
  ) {
    errors.push('SESSION_HOURS debe ser una cantidad de horas entre 1 y 168');
  }

  const notifyPhones = config.DELIVERY_NOTIFY_PHONES;
  if (
    typeof notifyPhones === 'string' &&
    notifyPhones.trim() &&
    notifyPhones
      .split(',')
      .some((phone) => !/^\+?[\d\s()-]{8,20}$/.test(phone.trim()))
  ) {
    errors.push(
      'DELIVERY_NOTIFY_PHONES debe ser una lista de teléfonos separados por coma',
    );
  }

  errors.push(...validateArca(config));
  errors.push(...validateMail(config));

  if (errors.length > 0) {
    throw new Error(`Configuración inválida:\n- ${errors.join('\n- ')}`);
  }

  return config;
}

function validateArca(config: Record<string, unknown>) {
  const errors: string[] = [];
  const value = (key: string) => {
    const raw = config[key];
    return typeof raw === 'string' ? raw.trim() : '';
  };

  if (value('ARCA_CUIT') && !/^\d{11}$/.test(value('ARCA_CUIT'))) {
    errors.push('ARCA_CUIT debe tener 11 dígitos, sin guiones');
  }

  if (value('ARCA_PTO_VTA') && !/^[1-9]\d{0,4}$/.test(value('ARCA_PTO_VTA'))) {
    errors.push('ARCA_PTO_VTA debe ser un número entre 1 y 99999');
  }

  if (!!value('ARCA_CERT_PATH') !== !!value('ARCA_KEY_PATH')) {
    errors.push(
      'ARCA_CERT_PATH y ARCA_KEY_PATH van juntas: definí las dos o ninguna',
    );
  }

  if (value('ARCA_PRODUCTION') !== 'true') {
    return errors;
  }

  for (const key of REQUIRED_ARCA_PRODUCTION_VARS) {
    if (!value(key)) {
      errors.push(`Con ARCA_PRODUCTION=true hay que definir ${key}`);
    }
  }

  for (const key of ['ARCA_CERT_PATH', 'ARCA_KEY_PATH']) {
    if (value(key) && !existsSync(value(key))) {
      errors.push(`No existe el archivo de ${key}: ${value(key)}`);
    }
  }

  return errors;
}

function validateMail(config: Record<string, unknown>) {
  const errors: string[] = [];
  const value = (key: string) => {
    const raw = config[key];
    return typeof raw === 'string' ? raw.trim() : '';
  };

  const gmailVars = [
    'GMAIL_USER',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
  ];
  const gmailSet = gmailVars.filter((key) => value(key));
  if (gmailSet.length > 0 && gmailSet.length < gmailVars.length) {
    errors.push(
      `Para mandar mails con Gmail faltan: ${gmailVars.filter((key) => !value(key)).join(', ')}`,
    );
  }

  if (!!value('SMTP_USER') !== !!value('SMTP_PASS')) {
    errors.push('SMTP_USER y SMTP_PASS van juntas: definí las dos o ninguna');
  }

  if (value('SMTP_PORT') && !/^\d{2,5}$/.test(value('SMTP_PORT'))) {
    errors.push('SMTP_PORT debe ser un número de puerto (465 o 587)');
  }

  return errors;
}
