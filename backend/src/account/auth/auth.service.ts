import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './login.dto';
import * as bcrypt from 'bcrypt';
import { JoinRepository } from '../join/join.repository';  // 추가

@Injectable()
export class AuthService {
    constructor(
        private jwtService: JwtService,
        private joinRepository: JoinRepository, 
    ) {}

    async login(dto: LoginDto) {
        const user = await this.joinRepository.findByUserId(dto.user_id);
        if (!user) {
            throw new UnauthorizedException('아이디, 또는 비밀번호가 일치하지 않습니다.');
        }

        const isMatch = await bcrypt.compare(dto.password, user.password);
        if (!isMatch) {
            throw new UnauthorizedException('아이디, 또는 비밀번호가 일치하지 않습니다.');
        }

        const payload = { sub: user.id };
        return {
            token: this.jwtService.sign(payload)
        };
    }
}