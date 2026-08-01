import { IsString, MaxLength, MinLength } from 'class-validator';

export class RotateWebhookRouteSecretDto {
  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  webhookRouteSecret: string;
}
