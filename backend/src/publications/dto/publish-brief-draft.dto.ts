import { Equals, IsBoolean, IsInt, Min } from 'class-validator';

export class PublishBriefDraftDto {
  @IsInt()
  @Min(1)
  draftVersion: number;

  @IsBoolean()
  @Equals(true)
  approved: true;
}

export class RetryPublicationDto extends PublishBriefDraftDto {}
