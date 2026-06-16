import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SyncBlogsDto {
  // 직접 검색하고 싶은 키워드 목록입니다.
  // 비워두면 ai-server/.env의 BLOG_SYNC_QUERIES를 사용합니다.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  // 키워드 하나당 블로그 검색 결과를 몇 개까지 가져올지 정합니다.
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
