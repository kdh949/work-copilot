import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class OidcCallbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  state: string;
}
