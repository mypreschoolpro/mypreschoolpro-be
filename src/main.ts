import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port');
  const apiPrefix = configService.get<string>('app.apiPrefix');
  const frontendUrl = configService.get<string>('app.frontendUrl');

  // Security
  app.use(helmet());
  app.use(cookieParser());

  // CORS
  app.enableCors({
    // origin: [frontendUrl, 'http://localhost:5173', 'http://localhost:3000' , 'http://localhost:8080' , "https://mypreschoolpro.lovable.app" , "https://c822a4c69d6e.ngrok-free.app"],
   origin: "*",
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix(apiPrefix || '');

  // API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger Documentation
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('PreSchool Pro API')
      .setDescription('PreSchool Pro Management System API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port || 3000);
  console.log(`🚀 Application is running on: http://localhost:${port}/${apiPrefix}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap();

