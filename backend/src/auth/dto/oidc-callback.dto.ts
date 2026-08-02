import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class OidcCallbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  state: string;

  // Keycloak appends these parameters to the authorization-code callback.
  // The verified ID token remains the authorization source of truth.
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  session_state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  iss?: string;
}
