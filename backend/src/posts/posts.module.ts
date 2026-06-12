import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostsController } from './posts.controller';
import { PostService } from './posts.service';
import { PostEntity } from './posts.entity';
import { AuthModule } from '../account/auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PostEntity])
  ],
  controllers: [PostsController],
  providers: [PostService],
  exports: [AuthModule]
})
export class PostsModule {}