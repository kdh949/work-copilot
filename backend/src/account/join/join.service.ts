// src/account/join/join.service.ts
import { Injectable, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JoinRepository } from './join.repository';
import { JoinDto } from './join.dto';

@Injectable()
export class JoinService {
  constructor(private readonly joinRepository: JoinRepository) {}

  async join(dto: JoinDto) {
    const existing = await this.joinRepository.findByUserId(dto.user_id);
    if (existing) {
      throw new ConflictException('이미 사용 중인 아이디입니다.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const member = await this.joinRepository.createMember(dto, hashedPassword);

    const { password, ...result } = member;
    return result;
  }
}