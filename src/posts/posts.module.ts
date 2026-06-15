import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { TypeOrmModule } from "@nestjs/typeorm";
import { Post } from "./post.entity";
import { UsersModule } from "../users/users.module";
import { AuthModule } from "../auth/auth.module";

@Module({
    imports: [TypeOrmModule.forFeature([Post]), UsersModule, AuthModule,], // 이 모듈에서 post.entity.ts의 Repository를 사용할 수 있게 한다.
    controllers: [PostsController], // 요청을 받을 Controller 등록
    providers: [PostsService] // NestJS가 주입해줄 Service 등록
})
export class PostsModule {
}
