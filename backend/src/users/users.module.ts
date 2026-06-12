import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';

@Module({
  /*
   NestJS + TypeORM에서는 “데이터베이스 연결 객체”를 직접 참조하기보다 Repository를 주입받아서 쓴다.
   먼저 users.module.ts에 User 엔티티 Repository를 등록해야 해요.
  */
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
