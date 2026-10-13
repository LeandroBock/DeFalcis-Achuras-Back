import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  configureApp(app);

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction || process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('DF Achuras API')
      .setDescription('API del sistema de gestión DF Achuras')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  // 🚀 Obtenemos el puerto de Render
  const port = process.env.PORT ?? 3000;

  // ⚠️ Agregamos '0.0.0.0' para que Render detecte el puerto correctamente
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`Application is running on port: ${port}`);
}

void bootstrap();
