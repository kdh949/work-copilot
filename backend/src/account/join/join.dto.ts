// src/account/join/join.dto.ts
import { IsString, IsNotEmpty, Length } from 'class-validator';

export class JoinDto {
    // 진입 전 검증
    @IsString()
    @IsNotEmpty()
    @Length(1, 50)
    user_id! : string;

    @IsString()
    @IsNotEmpty()
    @Length(8, 255)
    password! : string;

    @IsString()
    @IsNotEmpty()
    @Length(1, 50)
    name! : string;

    @IsString()
    @IsNotEmpty()
    @Length(1, 50)
    nickname! : string;
}