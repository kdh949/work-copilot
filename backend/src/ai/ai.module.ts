import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AuthModule } from '../auth/auth.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/post.entity';
import { AiSyncOutbox } from './ai-sync-outbox.entity';
import { AiSyncService } from './ai-sync.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Post, AiSyncOutbox])],
  controllers: [AiController],
  providers: [AiService, AiSyncService],
  exports: [AiService, AiSyncService],
})
export class AiModule {}
