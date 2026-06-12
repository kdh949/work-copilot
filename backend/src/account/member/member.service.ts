import { ConflictException, Injectable } from "@nestjs/common";
import { CreateMemberDto, EditMemberDto } from "./member.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { MemberEntity } from './member.entity'
import { Repository } from "typeorm";
import * as bcrypt from 'bcrypt';

@Injectable()
export class MemberService {
    constructor(
        @InjectRepository(MemberEntity)
        private readonly memberRepository : Repository<MemberEntity>
    ) {}

    // 현재 mvp 버전으로, 기본적인 요소만 검사.
    async join(dto: CreateMemberDto): Promise <void> {
        // 아이디 무결성 검사
        const exists = await this.checkMember(dto.user_id)
        if (exists) throw new ConflictException('이미 사용중인 아이디입니다.')
 
        // 비밀번호 해싱
        const hashedPassword = await this.hashingPassword(dto.password);
        
        // 데이터에 베이스 추가
        await this.memberRepository.save({
            ...dto,
            password: hashedPassword,
        });
    }

    edit(dto: EditMemberDto) {

    }

    deleteMember(id: number) {

    }

    // 로그인 시 사용할 메서드
    checkMember(userId: string) {
        return this.memberRepository.findOne({ where: {user_id: userId}})
    }



    // 메서드라 순서 상관x
    async hashingPassword(password: string) {
        return bcrypt.hash(password, 10);
    }
}