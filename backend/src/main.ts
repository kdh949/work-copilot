import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module'; // 앱의 루트 모듈
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CorrelationIdMiddleware } from './common/http/correlation-id.middleware';
import { OriginCsrfMiddleware } from './common/http/origin-csrf.middleware';
import { SafeHttpExceptionFilter } from './common/http/safe-http-exception.filter';
import {
  configureTrustProxy,
  isAllowedOrigin,
  parseFrontendOrigins,
  parseTrustProxyHops,
} from './config/security.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const allowedOrigins = parseFrontendOrigins(
    configService.get<string>('FRONTEND_ORIGINS'),
  );
  const trustProxyHops = parseTrustProxyHops(
    configService.get<string>('TRUST_PROXY_HOPS'),
  );

  configureTrustProxy(
    app.getHttpAdapter().getInstance(),
    trustProxyHops,
  );

  const correlationIdMiddleware = new CorrelationIdMiddleware();
  const originCsrfMiddleware = new OriginCsrfMiddleware(allowedOrigins);

  app.use(correlationIdMiddleware.use.bind(correlationIdMiddleware));

  app.enableCors({
    origin: (origin, callback) => {
      callback(null, !origin || isAllowedOrigin(origin, allowedOrigins));
    },
    credentials: true,
  });
  app.use(originCsrfMiddleware.use.bind(originCsrfMiddleware));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 없는 속성은 제거
      forbidNonWhitelisted: true, // DTO에 없는 속성이 오면 에러
      transform: true, // 요청 데이터를 DTO 타입에 맞게 변환하려고 시도
    }),
  );
  app.useGlobalFilters(new SafeHttpExceptionFilter());

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
