import { Body, Post, Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthService } from "./auth.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";
import { Request } from "express";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import type { AuthenticatedRequest } from "./guards/jwt-auth.guard";

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('signup')
    signup(@Body() signupDto: SignupDto) {
        return this.authService.signup(signupDto);
    }

    @Post('login')
    login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    @UseGuards(JwtAuthGuard) // GET /auth/me 요청은 JwtAuthGuard를 통과해야 실행됨
    @Get('me')
    me(@Req() request: AuthenticatedRequest) {
        return this.authService.me(request.user.sub); // 여기서 sub는 JWT payload에 넣었던 사용자 id
    }
}
