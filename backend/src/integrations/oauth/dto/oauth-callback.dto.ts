import { IsOptional, IsString, MaxLength } from 'class-validator';

export class OAuthCallbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  state?: string;

  // Providers return these values when consent or scope validation fails.
  // They are accepted only so the callback can return users to Work Copilot;
  // the provider-supplied text is never rendered or logged.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  error?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  error_description?: string;
}
