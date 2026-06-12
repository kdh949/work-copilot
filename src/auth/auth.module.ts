import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from "../users/users.module";

@Module({
    imports: [UsersModule], // AuthService에서 UsersService를 사용해야 하기 때문에 가져옴
    controllers: [AuthController],
    providers: [AuthService],
})
export class AuthModule {}
