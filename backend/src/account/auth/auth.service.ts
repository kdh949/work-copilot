import { Injectable, UnauthorizedException } from "@nestjs/common"; 
import { JwtService } from "@nestjs/jwt";
import { MemberService } from "../member/member.service";
import { LoginDto } from "./auth.dto";
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    constructor (
        private readonly jwtService : JwtService,
        private readonly memberService : MemberService
    ) {}

    async login(dto: LoginDto) {
        const data = await this.memberService.checkMember(dto.user_id); 
        if (!data)
            throw new UnauthorizedException('아이디 또는 비밀번호가 일치하지 않습니다.');
        
        const isMatch = await bcrypt.compare(dto.password, data.password);
        if (!isMatch)
            throw new UnauthorizedException('아이디 또는 비밀번호가 일치하지 않습니다.');

        const payload = {sub: data.id};
        return {
            token: this.jwtService.sign(payload)
        }
    }
}