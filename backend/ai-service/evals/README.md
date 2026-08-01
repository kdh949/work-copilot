# RAG Evals

1. 1,000개 위키를 적재한 뒤 `golden.template.jsonl`을 복사해 `golden.jsonl`로 만든다.
2. 각 `REPLACE_WITH_*` 값을 실제 `sourceId`로 바꾸고, 답변 가능한 문항은 최소 하나의 기대 출처를 가진다.
3. 같은 데이터·모델·환경 변수에서 두 검색 모드를 실행한다.

```bash
cd backend/ai-service
source .venv/bin/activate
python -m evals.run --cases evals/golden.jsonl --modes both
```

생성된 JSON·Markdown 보고서는 `evals/reports/`에만 저장하며, 검증 없이 수치를 포트폴리오에 기재하지 않는다.
