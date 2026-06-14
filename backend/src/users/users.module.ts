import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
// StringValue는 시간 문자열 형식을 제한해서 표현하는 TypeScript 타입
import type { StringValue } from 'ms';

@Module({
  /*
   NestJS + TypeORM에서는 “데이터베이스 연결 객체”를 직접 참조하기보다 Repository를 주입받아서 쓴다.
   먼저 users.module.ts에 User 엔티티 Repository를 등록해야 해요.
  */

  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          // JWT_EXPIRES_IN 환경변수 값도 undefined 일수 있어서 getOrThrow 사용
          expiresIn: config.getOrThrow<StringValue>('JWT_EXPIRES_IN'),
        },
      }),
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
