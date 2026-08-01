import { Module } from '@nestjs/common';
import { AppController } from './app.controller'; // HTTP 요청을 받는 곳
import { AppService } from './app.service';
import { PostsModule } from './posts/posts.module';
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';

@Module({ // 부품 조립 박스라고 생각
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),

        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const useSsl = configService.get<string>('DB_SSL')?.toLowerCase() === 'true';
                const rejectUnauthorized = configService
                    .get<string>('DB_SSL_REJECT_UNAUTHORIZED')
                    ?.toLowerCase() !== 'false';

                return {
                    type: "postgres",
                    host: configService.get<string>('DB_HOST'),
                    port: configService.get<number>('DB_PORT'),
                    username: configService.get<string>('DB_USERNAME'),
                    password: configService.get<string>('DB_PASSWORD'),
                    database: configService.get<string>('DB_DATABASE'),
                    ssl: useSsl ? { rejectUnauthorized } : false,
                    autoLoadEntities: true, // 각 모듈에서 등록한 Entity를 자동으로 로드한다.
                    synchronize: true, // Entity 클래스와 DB 테이블 구조를 자동으로 맞춘다.
                };
            }
        }),

        PostsModule,
        UsersModule,
        AuthModule,
        AiModule,
    ],
    controllers: [AppController], // 이 모듈은 AppController를 사용하고,
    providers: [AppService],      // AppService를 주입 가능한 서비스로 등록한다.
})
export class AppModule {}
