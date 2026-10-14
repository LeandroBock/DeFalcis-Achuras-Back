import { validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  const valid = {
    DB_HOST: 'localhost',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'secret',
    DB_NAME: 'dfachuras',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('acepta una configuración completa', () => {
    expect(validateEnv(valid)).toBe(valid);
  });

  it.each(['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET'])(
    'falla si falta %s',
    (key) => {
      expect(() => validateEnv({ ...valid, [key]: '' })).toThrow(key);
    },
  );

  it('falla si JWT_SECRET tiene menos de 32 caracteres', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'x'.repeat(31) })).toThrow(
      'al menos 32 caracteres',
    );
  });

  it('en producción exige CORS_ORIGINS', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      'CORS_ORIGINS',
    );

    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://dfachuras.com',
      }),
    ).not.toThrow();
  });

  it('informa todos los errores juntos', () => {
    expect(() => validateEnv({})).toThrow(/DB_HOST[\s\S]*JWT_SECRET/);
  });

  describe('ARCA', () => {
    const production = {
      ...valid,
      ARCA_PRODUCTION: 'true',
      ARCA_CUIT: '20123456789',
      ARCA_PTO_VTA: '3',
      ARCA_CERT_PATH: 'package.json', // cualquier archivo que exista
      ARCA_KEY_PATH: 'package.json',
      AFIPSDK_ACCESS_TOKEN: 'token',
      ARCA_BUSINESS_NAME: 'DF Achuras',
      ARCA_BUSINESS_ADDRESS: 'Calle 123',
      ARCA_IVA_CONDITION: 'Responsable Inscripto',
    };

    it('en modo prueba no exige nada', () => {
      expect(() => validateEnv(valid)).not.toThrow();
    });

    it.each([['20-12345678-9'], ['2012345678'], ['abc']])(
      'rechaza el CUIT %s',
      (cuit) => {
        expect(() => validateEnv({ ...valid, ARCA_CUIT: cuit })).toThrow(
          'ARCA_CUIT debe tener 11 dígitos',
        );
      },
    );

    it.each([['0'], ['100000'], ['uno']])(
      'rechaza el punto de venta %s',
      (ptoVta) => {
        expect(() => validateEnv({ ...valid, ARCA_PTO_VTA: ptoVta })).toThrow(
          'ARCA_PTO_VTA',
        );
      },
    );

    it('certificado y clave van juntos', () => {
      expect(() =>
        validateEnv({ ...valid, ARCA_CERT_PATH: 'cert.crt' }),
      ).toThrow('van juntas');
    });

    it('en producción acepta la configuración completa', () => {
      expect(() => validateEnv(production)).not.toThrow();
    });

    it('en producción exige todos los datos obligatorios', () => {
      expect(() =>
        validateEnv({ ...production, AFIPSDK_ACCESS_TOKEN: '' }),
      ).toThrow('AFIPSDK_ACCESS_TOKEN');

      expect(() =>
        validateEnv({ ...production, ARCA_BUSINESS_NAME: '' }),
      ).toThrow('ARCA_BUSINESS_NAME');
    });

    it('en producción verifica que existan los archivos del certificado', () => {
      expect(() =>
        validateEnv({ ...production, ARCA_CERT_PATH: './certs/no-existe.crt' }),
      ).toThrow('No existe el archivo de ARCA_CERT_PATH');
    });
  });

  it('WHATSAPP_ENABLED solo acepta true o false', () => {
    expect(() =>
      validateEnv({ ...valid, WHATSAPP_ENABLED: 'true' }),
    ).not.toThrow();
    expect(() => validateEnv({ ...valid, WHATSAPP_ENABLED: 'si' })).toThrow(
      'WHATSAPP_ENABLED',
    );
  });

  it('DELIVERY_NOTIFY_PHONES acepta una lista de teléfonos', () => {
    expect(() =>
      validateEnv({
        ...valid,
        DELIVERY_NOTIFY_PHONES: '3415556789, +54 9 341 555-1111',
      }),
    ).not.toThrow();
    expect(() =>
      validateEnv({ ...valid, DELIVERY_NOTIFY_PHONES: 'juan@mail.com' }),
    ).toThrow('DELIVERY_NOTIFY_PHONES');
  });

  it('SESSION_HOURS acepta horas entre 1 y 168', () => {
    expect(() => validateEnv({ ...valid, SESSION_HOURS: '8' })).not.toThrow();
    expect(() => validateEnv({ ...valid, SESSION_HOURS: '0' })).toThrow(
      'SESSION_HOURS',
    );
    expect(() => validateEnv({ ...valid, SESSION_HOURS: 'ocho' })).toThrow(
      'SESSION_HOURS',
    );
  });
});
