// src/account/account.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { JoinModule } from './join/join.module';

@Module({
  imports: [AuthModule, JoinModule],
})
export class AccountModule {}