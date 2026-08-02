import { IsString, MaxLength } from 'class-validator';

export class ConfluenceSearchDto {
  @IsString()
  @MaxLength(200)
  q: string;
}
