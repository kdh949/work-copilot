// src/account/join/join.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../member.entity';
import { JoinRepository } from './join.repository';
import { JoinService } from './join.service';
import { JoinController } from './join.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Member])],
  providers: [JoinService, JoinRepository],
  controllers: [JoinController],
  exports: [JoinRepository],
})
export class JoinModule {}