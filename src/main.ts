import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const cors = config.getOrThrow<AppConfig['cors']>('cors');
  app.enableCors({
    origin: cors.allowedOrigins,
    methods: cors.allowedMethods,
    allowedHeaders: cors.allowedHeaders,
    credentials: cors.allowCredentials,
    maxAge: cors.maxAge,
  });

  // ProtectService drains its in-flight crawler dispatches in onModuleDestroy; without this,
  // SIGTERM kills the process before those fire-and-forget calls land.
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('server.port');
  await app.listen(port);
  new Logger('Bootstrap').log(`GGEE Lightweight Backend listening on :${port}`);
}

void bootstrap();
