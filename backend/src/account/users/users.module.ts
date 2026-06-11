import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemberService } from './users.service';
import { MemberController } from './users.controller';
import { MemberEntity } from './users.entity';

@Module({
    imports: [TypeOrmModule.forFeature([MemberEntity])],
    controllers: [MemberController],
    providers: [MemberService],
    exports: [MemberService]
})
export class MemberModule {}