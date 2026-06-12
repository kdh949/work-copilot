import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from "../users/users.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";

type SignupResponse = {
    id: number;
    email: string;
    nickname: string;
    createdAt: Date;
};

type LoginResponse = {
    id: number;
    email: string;
    nickname: string;
};

@Injectable()
export class AuthService {
    constructor(private readonly usersService: UsersService) {}

    async signup(signupDto: SignupDto): Promise<SignupResponse> {
        const hashedPassword = await bcrypt.hash(signupDto.password, 10);

        const user = await this.usersService.create({
            email: signupDto.email,
            password: hashedPassword,
            nickname: signupDto.nickname,
        });

        return {
            id: user.id,
            email: user.email,
            nickname: user.nickname,
            createdAt: user.createdAt,
        }; // UsersService의 반환값을 그대로 반환하지 않고, AuthService에서 응답 객체를 직접 만들어 반환함
           // 이를 통해 password를 반환에 포함시키지 않을 수 있음
    }

    async login(loginDto: LoginDto): Promise<LoginResponse> {
        const user = await this.usersService.findByEmail(loginDto.email);

        if (!user) {
            throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
        }

        const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);

        if (!isPasswordValid) {
            throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
        }

        return {
            id: user.id,
            email: user.email,
            nickname: user.nickname,
        };
    }
}
