import { Controller, Body, Post, UseGuards, Req, Get } from '@nestjs/common';
import { AuthService } from './auth.service'
import { LoginDto } from './auth.dto';
import { AuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
    constructor (
        private readonly authService : AuthService
    ) {}

    @UseGuards(AuthGuard)
    @Get('verify')
    verify(@Req() req) {
        return {ok: true, id: req.user.sub}
    }

    @Post('login') 
    login(@Body() dto : LoginDto) {
        return this.authService.login(dto);
    }
}