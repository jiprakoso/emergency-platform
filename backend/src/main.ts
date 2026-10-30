import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { ValidationPipe } from '@nestjs/common';
import { setupApiDocs } from './docs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  // Kesehatan ikut di bawah prefix versi (kontrak `GET /health`, `/health/ready`).
  app.setGlobalPrefix('api/v1');
  // Swagger UI dari contracts/openapi.yaml (dev/test saja).
  setupApiDocs(app);
  const port = process.env.PORT || 3000;
  await app.listen(port);
}
void bootstrap();
