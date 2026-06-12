export class CreateMemberDto {
    user_id!: string;
    password!: string;
    name!: string;
    nickname!: string;
}

export class EditMemberDto {
    password!: string;
    nickname!: string;
}