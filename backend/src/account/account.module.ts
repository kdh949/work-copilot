// src/account/account.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { JoinModule } from './join/join.module';
import { Member } from './member.entity';

@Module({
  imports: [AuthModule, JoinModule],
  exports: [Member],
})
export class AccountModule {}