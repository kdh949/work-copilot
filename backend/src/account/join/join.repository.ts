// src/account/join/join.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Member } from '../member.entity';
import { JoinDto } from './join.dto';

@Injectable()
export class JoinRepository {
  constructor(
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
  ) {}

  async findByUserId(user_id: string): Promise<Member | null> {
    return this.memberRepo.findOne({ where: { user_id } });
  }

  async createMember(dto: JoinDto, hashedPassword: string): Promise<Member> {
    const member = this.memberRepo.create({
      user_id: dto.user_id,
      password: hashedPassword,
      name: dto.name,
      nickname: dto.nickname,
    });
    return this.memberRepo.save(member);
  }
}