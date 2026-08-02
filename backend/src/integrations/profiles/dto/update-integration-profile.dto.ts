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

export class UpdateIntegrationProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  jiraBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  confluenceBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  jiraClientId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  confluenceClientId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  jiraClientSecret?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  confluenceClientSecret?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  jiraScopes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  confluenceScopes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  allowedProjectKeys?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  allowedSpaceKeys?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  briefParentPageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  childTaskIssueTypeId?: string;

  @IsOptional()
  @IsObject()
  childTaskTemplateFields?: Record<string, unknown>;
}
