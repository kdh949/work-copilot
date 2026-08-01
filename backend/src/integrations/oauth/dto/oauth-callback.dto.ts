import { IsString, MaxLength } from 'class-validator';

export class OAuthCallbackDto {
  @IsString()
  @MaxLength(4096)
  code: string;

  @IsString()
  @MaxLength(512)
  state: string;
}
