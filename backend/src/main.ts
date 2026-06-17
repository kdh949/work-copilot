import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = new Set([
    'http://localhost:5173',
    'http://localhost:5174',
    process.env.FRONTEND_URL,
  ].filter((origin): origin is string => Boolean(origin)));

  // cors에러 해결 브라우저 입장에서 포트가 다르면 다른 출처이다.
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin) || /\.vercel\.app$/.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // DTO에 없는 필드를 자동으로 제거
      whitelist: true,
      // DTO에 없는 필드가 들어오면 제거하지 않고 아예 에러를 낸다
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
