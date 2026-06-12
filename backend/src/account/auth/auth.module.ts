import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MemberModule } from '../member/member.module';
import { AuthGuard } from './auth.guard'

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET ?? 'key',
            signOptions: {expiresIn: '1h'},
        }),
        MemberModule,
    ],
    controllers: [AuthController],
    providers: [AuthService, AuthGuard],
    exports: [AuthGuard]
})
export class AuthModule {}