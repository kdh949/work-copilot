import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Post } from "../posts/post.entity";

@Module({
    imports: [AuthModule, UsersModule, TypeOrmModule.forFeature([Post])],
    controllers: [AiController],
    providers: [AiService],
    exports: [AiService],
})
export class AiModule {}
