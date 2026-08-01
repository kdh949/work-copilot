import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';

type SignupResponse = {
  id: number;
  email: string;
  nickname: string;
  department: string | null;
  employeeNumber: string | null;
  role: string;
  createdAt: Date;
};

type LoginResponse = {
  accessToken: string;
};

type MeResponse = {
  id: number;
  email: string;
  nickname: string;
  department: string | null;
  employeeNumber: string | null;
  role: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(signupDto: SignupDto): Promise<SignupResponse> {
    const hashedPassword = await bcrypt.hash(signupDto.password, 10);
    const userCount = await this.usersService.count();
    const role = userCount === 0 ? 'admin' : 'employee';

    const user = await this.usersService.create({
      email: signupDto.email,
      password: hashedPassword,
      nickname: signupDto.nickname,
      department: signupDto.department,
      employeeNumber: signupDto.employeeNumber,
      role,
    });

    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      department: user.department,
      employeeNumber: user.employeeNumber,
      role: user.role,
      createdAt: user.createdAt,
    }; // UsersService의 반환값을 그대로 반환하지 않고, AuthService에서 응답 객체를 직접 만들어 반환함
    // 이를 통해 password를 반환에 포함시키지 않을 수 있음
  }

  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const user = await this.usersService.findByEmailWithPassword(
      loginDto.email,
    );

    if (!user?.password) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      department: user.department,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
    };
  }

  async me(userId: number): Promise<MeResponse> {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException();
    }

    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      department: user.department,
      employeeNumber: user.employeeNumber,
      role: user.role,
    };
  }
}
