import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JoinModule } from '../users/users.module';

@Module ({
    imports : [
        PassportModule,
        JwtModule.register ({
            secret : process.env.JWT_SECRET ?? 'key',
            signOptions : {expiresIn: '1d' },
        }),
        JoinModule,
    ], 
    controllers : [AuthController],
    providers : [AuthService],
})

export class AuthModule {}