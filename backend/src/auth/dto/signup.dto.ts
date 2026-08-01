import { IsEmail, IsIn, IsNotEmpty, IsString, MinLength } from "class-validator";

export const SIGNUP_DEPARTMENTS = ['제품', '엔지니어링', '고객성공', '인사', '총무', '재무'];

export class SignupDto {
    @IsString()
    @IsNotEmpty()
    employeeNumber: string;

    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @MinLength(8)
    password: string;

    @IsString()
    @IsNotEmpty()
    nickname: string;

    @IsString()
    @IsNotEmpty()
    @IsIn(SIGNUP_DEPARTMENTS)
    department: string;
}
