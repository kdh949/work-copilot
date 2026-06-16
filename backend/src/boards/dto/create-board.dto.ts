import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBoardDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  // 새 구조에서는 태그를 여러 개 배열로 받습니다.
  // 예: ["알고리즘", "정글", "후기"]
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  tags!: string[];

  // 예전 코드가 tag 하나만 보내도 서버가 받을 수 있게 남겨둔 값입니다.
  @IsOptional()
  @IsString()
  tag?: string;

  @IsString()
  @IsNotEmpty()
  writer!: string;
}
