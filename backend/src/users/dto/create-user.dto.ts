import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  // id는 db가 자동 생성하기 때문에 회원가입 요청 DTO에 id를 받을 필요가 없다.
  // id!: number;
  @IsString()
  @IsNotEmpty()
  loginId!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: '비밀번호는 최소 6자 이상이어야 합니다.' })
  password!: string;
}
