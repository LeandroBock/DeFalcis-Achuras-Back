import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 🌐 Ajustamos CORS para que acepte tanto local como producción más adelante
  app.enableCors({
    origin: '*', // 💡 '*' permite peticiones desde cualquier origen (útil para desarrollo/testeo en producción)
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('DF Achuras API')
    .setDescription('API del sistema de gestión DF Achuras')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // 🚀 Obtenemos el puerto de Render
  const port = process.env.PORT ?? 3000;
  
  // ⚠️ Agregamos '0.0.0.0' para que Render detecte el puerto correctamente
  await app.listen(port, '0.0.0.0');
  
  console.log(`Application is running on port: ${port}`);
}

bootstrap();
