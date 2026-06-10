import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './login.dto';
import * as bcrypt from 'bcrypt';

// 의존성 주입. 싱글톤 패턴. new 안씀.
@Injectable()
export class AuthService {
    // 생성자로 jwtService에 jwtService 클래스 타입 선언
    constructor( private jwtService : JwtService) {}

    // LoginDto 클래스에 id랑 password 담겨있음
    async login(dto : LoginDto) {
        const user = { id: dto.user_id, password: dto.password };

        const isMatch = await bcrypt. compare(dto.password, user.password);
        if (!isMatch) {
            throw new UnauthorizedException('아이디, 또는 비밀번호가 일치하지 않습니다.');
        }

        const payload = { sub: user.id };
        return {
            token: this.jwtService.sign(payload)
        }

    }
}