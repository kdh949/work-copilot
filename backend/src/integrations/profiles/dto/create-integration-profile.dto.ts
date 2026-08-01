import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateIntegrationProfileDto {
  @IsString()
  @MaxLength(2048)
  jiraBaseUrl: string;

  @IsString()
  @MaxLength(2048)
  confluenceBaseUrl: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  jiraClientId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  confluenceClientId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  jiraClientSecret: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  confluenceClientSecret: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  jiraScopes: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  confluenceScopes: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  allowedProjectKeys: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  allowedSpaceKeys: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  briefParentPageId: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  childTaskIssueTypeId?: string;

  @IsOptional()
  @IsObject()
  childTaskTemplateFields?: Record<string, unknown>;
}
