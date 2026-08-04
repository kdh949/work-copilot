import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class PublishBriefDraftDto {
  @IsInt()
  @Min(1)
  draftVersion: number;

  @IsBoolean()
  @Equals(true)
  approved: true;

  /**
   * Binds the explicit approval to the exact server-generated preview.  A
   * digest, rather than preview markup, keeps this command surface small and
   * prevents a client from substituting a different destination or body.
   */
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  previewHash: string;
}

export class RetryPublicationDto extends PublishBriefDraftDto {
  @IsIn(['confluence', 'jira', 'child_tasks'])
  phase: 'confluence' | 'jira' | 'child_tasks';
}
