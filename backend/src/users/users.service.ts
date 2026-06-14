import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    // DTO 객체를 user 엔티티 객체 형태로 만들어주는 함수
    /*
      메모리 안에 이런 객체가 생긴다.
      User {
        loginId: 'abc',
        password: '1234'
      }
    */
    const user = this.usersRepository.create(createUserDto);
    // save() -> 실제 DB에 insert/update함
    return await this.usersRepository.save(user);
  }
  // Todo
  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return this.usersRepository.findOneBy({ id });
  }

  findByLoginId(loginId: string) {
    return this.usersRepository.findOneBy({ loginId });
  }
  // Todo
  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return this.usersRepository.delete({ id });
  }

  async login(loginId: string, password: string) {
    const user = await this.usersRepository.findOneBy({ loginId });

    if (!user) {
      throw new UnauthorizedException('아이디 또는 비밀번호가 틀렸습니다.');
    }

    if (user.password !== password) {
      throw new UnauthorizedException('아이디 또는 비밀번호가 틀렸습니다.');
    }

    const payload = {
      sub: user.id,
      loginId: user.loginId,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        loginId: user.loginId,
      },
    };
  }
}
