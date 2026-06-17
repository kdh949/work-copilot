import { Module } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { BoardsController } from './boards.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Board } from './entities/board.entity';
import { Tag } from './entities/tag.entity';
import { User } from '../users/entities/user.entity';
// BoardService에서 JwtService를 쓰려면 BoardsModule에도 JWtModule 등록해야함
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    // Board와 Tag 저장소를 BoardsService에서 쓸 수 있게 등록합니다.
    TypeOrmModule.forFeature([Board, Tag, User]),
    AiModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow<StringValue>('JWT_EXPIRES_IN'),
        },
      }),
    }),
  ], // BoardsService constructor에서 JwtService를 받을 수 있습니다.
  controllers: [BoardsController],
  providers: [BoardsService],
})
export class BoardsModule {}
