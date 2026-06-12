import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // cors에러 해결 브라우저 입장에서 포트가 다르면 다른 출처이다.
  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
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
bootstrap();
