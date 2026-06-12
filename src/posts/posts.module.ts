import {Module} from '@nestjs/common';
import {PostsController} from './posts.controller';
import {PostsService} from './posts.service';

@Module({
    controllers: [PostsController], // 요청을 받을 Controller 등록
    providers: [PostsService] // NestJS가 주입해줄 Service 등록
})
export class PostsModule {
}
