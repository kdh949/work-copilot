import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module'; // 앱의 루트 모듈
import { ValidationPipe } from "@nestjs/common";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true, // DTO에 없는 속성은 제거
            forbidNonWhitelisted: true, // DTO에 없는 속성이 오면 에러
            transform: true // 요청 데이터를 DTO 타입에 맞게 변환하려고 시도
        }),
    );

    await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
