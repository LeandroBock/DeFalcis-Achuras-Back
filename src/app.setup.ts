import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

// Configuración HTTP común a producción y a los tests de integración.
export function configureApp(app: NestExpressApplication) {
  const isProduction = process.env.NODE_ENV === 'production';

  // Render pone un proxy adelante: sin esto el rate limit vería siempre la IP
  // del proxy en lugar de la del cliente.
  app.set('trust proxy', 1);

  app.use(helmet());

  // CORS_ORIGINS: dominios del frontend separados por coma.
  // En desarrollo, si no está definida, se acepta cualquier origen.
  const corsOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : !isProduction,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
}
