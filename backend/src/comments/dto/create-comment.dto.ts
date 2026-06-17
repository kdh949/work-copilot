import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateCommentDto {
  @IsInt()
  boardId!: number;

  @IsString()
  @IsNotEmpty()
  content!: string;
}
