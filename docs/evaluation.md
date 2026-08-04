# Work Copilot 평가 기준

Work Copilot의 검증은 **제품 동작**, **검색·생성 품질**, **보안·권한**을 나누어 기록합니다. 테스트 개수만으로 AI 결과의 품질을 설명하지 않고, 같은 데이터와 모델에서 다시 실행할 수 있는 보고서만 수치로 사용합니다.

## 1. 평가 범위

### 제품 동작

- 사용자별 Jira·Confluence 권한 차이
- Evidence와 Citation 연결
- 원문 Version 변경과 재검토 상태
- 사용자 승인 전 외부 쓰기 차단
- Idempotency-Key 기반 중복 실행 방지
- 부분 게시 실패와 단계별 재처리

### 검색·생성 품질

- 관련 문서가 상위 검색 결과에 포함되는지
- 생성된 요구사항과 다음 작업이 기대 근거를 가리키는지
- 존재하지 않는 원문이나 URL을 만들지 않는지
- 답변 가능한 질문과 근거 부족 질문을 구분하는지

### 보안·데이터 처리

- 다른 사용자의 권한 밖 문서가 노출되지 않는지
- 비밀정보 차단과 한국어 PII 마스킹 정확도
- 원문 발췌의 보관 시간과 암호화
- 외부 URL·Provider 설정 Allowlist

## 2. 현재 자동 검증 기록

기준: `main@08d2e3e` · 2026-08-03

| 영역 | 기록 |
| --- | --- |
| Node | 64개 Suite, 178개 Test |
| FastAPI AI Service | 26개 Test |
| 대표 시나리오 | 권한 차이, DLP, Citation, Freshness, 중복 요청, 부분 게시 실패 |

실행 명령:

```bash
npm run build
npm test
docker compose --env-file deploy/.env.production.example config --quiet
```

```bash
cd backend/ai-service
source .venv/bin/activate
python -m unittest discover -s tests -p 'test_*.py'
```

## 3. RAG 평가 절차

평가 도구는 [`backend/ai-service/evals`](../backend/ai-service/evals)에 있습니다.

1. 동일한 위키 데이터와 모델을 사용합니다.
2. `golden.template.jsonl`을 복사해 `golden.jsonl`을 만듭니다.
3. 플레이스홀더를 실제 `sourceId`로 바꿉니다.
4. 답변 가능한 문항에는 최소 하나의 기대 출처를 지정합니다.
5. 기준 검색과 하이브리드 검색을 같은 조건에서 실행합니다.

```bash
cd backend/ai-service
source .venv/bin/activate
python -m evals.run --cases evals/golden.jsonl --modes both
```

생성된 JSON·Markdown 보고서는 `evals/reports/`에 저장합니다.

## 4. 기록할 지표

### Retrieval

| 지표 | 의미 |
| --- | --- |
| Recall@5 | 기대 출처가 상위 5개 결과 안에 포함된 문항 비율 |
| MRR | 첫 번째 기대 출처가 나타난 순위를 반영한 평균 |
| Empty-result accuracy | 근거가 없는 질문에서 검색 결과를 비우거나 답변을 중단한 비율 |

### Citation

| 지표 | 의미 |
| --- | --- |
| Citation coverage | 근거가 필요한 생성 항목 중 Evidence ID가 연결된 비율 |
| Citation validity | 연결된 Evidence ID와 URL이 실제 조회 결과에 존재하는 비율 |
| Unsupported claim rate | 선택된 근거로 확인할 수 없는 주장의 비율 |

### DLP·PII

| 지표 | 의미 |
| --- | --- |
| Precision | 마스킹한 항목 중 실제 민감정보의 비율 |
| Recall | 실제 민감정보 중 탐지·마스킹한 비율 |
| Over-redaction rate | 업무 의미를 훼손할 정도로 일반 문구를 잘못 제거한 비율 |

### 제품 경계

| 시나리오 | 통과 기준 |
| --- | --- |
| 권한 밖 문서 | 다른 사용자의 원문·발췌·Citation 노출 0건 |
| 원문 Version 변경 | 게시 전에 `REVIEW_REQUIRED` 또는 동등한 재검토 상태로 전환 |
| 같은 Idempotency-Key 재요청 | 외부 객체 중복 생성 0건 |
| 게시 중 일부 단계 실패 | 성공 단계는 유지하고 실패 단계만 재처리 |
| DLP 차단 | 모델 호출 또는 외부 게시 전에 요청 종료 |

## 5. 보고서에 함께 남길 정보

정량 수치를 README나 포트폴리오에 사용할 때는 다음 정보를 함께 기록합니다.

- 기준 Commit SHA
- 실행 날짜
- 데이터셋 이름과 문항 수
- 검색 모드와 `topK`
- Embedding·Chat 모델
- 주요 Prompt 또는 평가 스키마 Version
- p50·p95 응답 시간과 평균 호출 비용을 측정한 위치
- 실패 문항과 원인 분류

실제 `sourceId`가 연결된 Golden Set과 실행 보고서가 없는 값은 공개 성과 수치로 사용하지 않습니다.
