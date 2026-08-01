import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class WorkBriefEvidenceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  evidenceId: string;

  @IsString()
  @MaxLength(8_000)
  content: string;
}

export class GenerateWorkBriefDto {
  @IsString()
  @MaxLength(2_000)
  instruction: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WorkBriefEvidenceDto)
  evidence: WorkBriefEvidenceDto[];
}
