import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class EvidenceCitationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8_000)
  text: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  evidenceIds: string[];

  @IsOptional()
  @IsBoolean()
  userAuthored?: boolean;
}

export class BriefChildTaskDto extends EvidenceCitationDto {
  @IsUUID()
  clientTaskId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  summary: string;

  @IsBoolean()
  selected: boolean;
}

export class BriefContentDto {
  @ValidateNested()
  @Type(() => EvidenceCitationDto)
  title: EvidenceCitationDto;

  @ValidateNested()
  @Type(() => EvidenceCitationDto)
  summary: EvidenceCitationDto;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EvidenceCitationDto)
  requirements: EvidenceCitationDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EvidenceCitationDto)
  acceptanceCriteria: EvidenceCitationDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EvidenceCitationDto)
  risks: EvidenceCitationDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EvidenceCitationDto)
  nextSteps: EvidenceCitationDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BriefChildTaskDto)
  childTasks: BriefChildTaskDto[];
}

export class CreateBriefDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sourceJiraKey: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  selectedEvidenceIds: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  instruction: string;
}

export class UpdateBriefDraftDto {
  @IsInt()
  @Min(1)
  optimisticVersion: number;

  @ValidateNested()
  @Type(() => BriefContentDto)
  content: BriefContentDto;
}

export class RefreshBriefDraftDto {
  @IsInt()
  @Min(1)
  optimisticVersion: number;
}
