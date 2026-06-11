import { Body, Controller, Delete, Param, Post, Put } from "@nestjs/common";
import { MemberService } from "./users.service";
import { CreateMemberDto, EditMemberDto } from "./users.dto";

// 프론트에서 탐색하는 폴더 경로
@Controller('account')
export class MemberController {
    // 생성자
    constructor( private readonly memberService: MemberService ) {}
    
    // 회원가입 로직
    @Post('join')
    joinMember(@Body() dto: CreateMemberDto) {
        return this.memberService.join(dto)
    }

    // 회원 수정
    @Put('edit')
    editMember(@Body() dto: EditMemberDto) {
        return this.memberService.edit(dto)
    }

    @Delete(':id')
    deleteMember(@Param('id') id: number) {
        return this.memberService.deleteMember(id)
    }
}