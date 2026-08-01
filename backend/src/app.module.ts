import { Module } from '@nestjs/common';
import { AppController } from './app.controller'; // HTTP 요청을 받는 곳
import { AppService } from './app.service';
import { PostsModule } from './posts/posts.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { createDatabaseOptionsFromConfig } from './config/database.config';
import { IntegrationProfilesModule } from './integrations/profiles/integration-profiles.module';

@Module({
  // 부품 조립 박스라고 생각
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...createDatabaseOptionsFromConfig(configService),
        autoLoadEntities: true,
      }),
    }),

    PostsModule,
    UsersModule,
    AuthModule,
    AiModule,
    IntegrationProfilesModule,
  ],
  controllers: [AppController], // 이 모듈은 AppController를 사용하고,
  providers: [AppService], // AppService를 주입 가능한 서비스로 등록한다.
})
export class AppModule {}
