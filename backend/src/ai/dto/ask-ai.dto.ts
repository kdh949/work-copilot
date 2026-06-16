import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AskAiDto {
  // 사용자가 AI 멘토에게 묻고 싶은 질문입니다.
  @IsString()
  question: string;

  // RAG에서 참고 자료를 몇 개까지 가져올지 정합니다.
  // 비워두면 FastAPI 쪽 기본값 5개를 사용합니다.
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  // GitHub repo를 분석하고 싶을 때만 넣는 주소입니다.
  @IsOptional()
  @IsString()
  repositoryUrl?: string;
}
