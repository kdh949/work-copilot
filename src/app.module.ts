import { Module } from '@nestjs/common';
import { AppController } from './app.controller'; // HTTP 요청을 받는 곳
import { AppService } from './app.service';
import { PostsModule } from './posts/posts.module';

@Module({ // 부품 조립 박스라고 생각
  imports: [PostsModule],
  controllers: [AppController], // 이 모듈은 AppController를 사용하고,
  providers: [AppService],      // AppService를 주입 가능한 서비스로 등록한다.
})
export class AppModule {}
