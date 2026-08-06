import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { DraftStatus } from '../brief-draft.types';

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

/**
 * A bounded, current-profile lookup for the assigned-issue picker.  This is
 * deliberately separate from the paginated draft list: the picker needs an
 * authoritative answer for every issue currently on screen.
 */
export class LookupBriefDraftsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  sourceJiraKeys: string[];
}

export class UpdateBriefDraftDto {
  @IsInt()
  @Min(1)
  optimisticVersion: number;

  @ValidateNested()
  @Type(() => BriefContentDto)
  content: BriefContentDto;
}

export class RegenerateBriefDraftDto {
  @IsInt()
  @Min(1)
  optimisticVersion: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  instruction: string;

  /** Omitted keeps the draft's current evidence selection. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  selectedEvidenceIds?: string[];
}

export class RefreshBriefDraftDto {
  @IsInt()
  @Min(1)
  optimisticVersion: number;
}

export const DRAFT_LIST_DEFAULT_LIMIT = 20;
export const DRAFT_LIST_MAX_LIMIT = 50;

export class ListBriefDraftsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DRAFT_LIST_MAX_LIMIT)
  limit?: number;

  // Opaque base64url keyset cursor. The charset is pinned so a malformed
  // cursor is rejected by validation rather than reaching the decoder.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;

  @IsOptional()
  @IsIn(['draft', 'review_required'])
  status?: DraftStatus;
}
