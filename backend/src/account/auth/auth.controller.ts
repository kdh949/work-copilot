import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';

// auth 관리 하는 컨트롤러인듯?
// Controller는 auth라는 경로를 담당하는 클래스임을 선언
@Controller('auth')
export class AuthController {
    constructor(private authService : AuthService) {} // 생성자

    // @Post 데코레이터는 HTTP 프로토콜 중, post 요청을 처리함
    // 'login'은 auth/login 경로로 요청 처리
    @Post('login')
    login(@Body() dto : LoginDto) {
        return this.authService.login(dto);
    }
}