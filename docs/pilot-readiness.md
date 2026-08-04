# Work Copilot 파일럿 검증 기준

이 문서는 Work Copilot을 실제 업무 환경에 적용하기 전에 확인할 제품 경계, 수용 조건과 증거 기록 형식을 정리합니다. 검증 대상은 단순 생성 품질뿐 아니라 **사용자 권한, 근거 최신성, 민감정보 처리, 승인과 외부 변경, 중복 실행과 부분 실패**입니다.

## 검증 범위

| 영역 | 확인할 내용 |
| --- | --- |
| 서비스 세션 | Keycloak 로그인, HttpOnly session, CSRF·Origin 검증 |
| 원천 접근 | 사용자별 Atlassian OAuth, Project·Space·Parent Page 범위, 권한 상실 처리 |
| Evidence | Provider ID, URL, Version, 최소 발췌와 Citation 연결 |
| AI 입력 | 비밀정보 차단, 한국어 PII 마스킹, 최소 발췌 전달 |
| 브리프 | 요구사항, 위험, 하위 작업과 근거의 연결 |
| Readiness | 필수 필드, Citation, Blocker, 근거 최신성 확인 |
| Publication | 사용자 승인, Idempotency-Key, 단계별 게시 상태 |
| Freshness | Jira·Confluence Webhook 변경 신호와 재검토 상태 |
| 실패 처리 | 중복 요청, 일부 하위 작업 실패, 재시도와 상태 수렴 |

## 핵심 수용 시나리오

| ID | 시나리오 | 기대 결과 |
| --- | --- | --- |
| AUTH-01 | 서로 다른 권한을 가진 사용자 A와 B가 같은 이슈를 조회 | 각 사용자가 원천 시스템에서 볼 수 있는 Evidence만 후보로 나타나며 다른 사용자의 원문이 섞이지 않음 |
| AUTH-02 | 브리프 생성 후 사용자가 원문 접근 권한을 잃음 | 게시 준비 확인에서 해당 Evidence를 신뢰하지 않고 재검토 상태로 전환 |
| FRESH-01 | Evidence로 사용한 문서의 Version이 변경됨 | 기존 Draft를 그대로 게시하지 않고 최신 근거 확인을 요구 |
| DLP-01 | 입력 발췌에 비밀정보 패턴이 포함됨 | AI 호출 전에 차단하고 사용자에게 수정 가능한 오류를 반환 |
| DLP-02 | 입력 발췌에 한국어 PII가 포함됨 | 최소 발췌 안에서 마스킹된 값만 AI 서비스에 전달 |
| CITE-01 | 생성 항목이 선택된 Evidence와 연결되지 않음 | Readiness를 통과하지 못하며 게시할 수 없음 |
| READY-01 | 필수 필드 또는 차단 의존성이 남아 있음 | 읽기 전용 점검 결과에 누락·Blocker를 표시하고 승인 단계로 진행하지 않음 |
| PUB-01 | 동일한 Idempotency-Key로 게시 요청을 반복 | Jira에 중복 이슈·하위 작업을 만들지 않고 기존 처리 결과를 반환 |
| PUB-02 | 여러 하위 작업 중 일부 게시만 실패 | 성공한 단계는 유지하고 실패한 단계만 다시 실행할 수 있음 |
| PUB-03 | 승인 뒤 게시 직전에 근거 Version이 변경됨 | 외부 변경을 시작하지 않고 최신성 확인 단계로 되돌림 |
| WEBHOOK-01 | 연결된 Jira·Confluence 자료의 변경 Webhook 수신 | 관련 Draft를 다시 검토해야 하는 상태로 표시 |
| RET-01 | 임시 원문 발췌의 보관 시간이 만료됨 | 암호화된 임시 원문은 제거하고 마스킹된 결과와 근거 식별자·Version만 유지 |

## 검증 실행

### Node.js 서비스

```bash
npm run build
npm test
```

### FastAPI AI 서비스

```bash
cd backend/ai-service
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m unittest discover -s tests -p 'test_*.py'
```

### AI 검색 평가

Golden Set의 `sourceId`를 실제 적재 데이터와 연결한 뒤 baseline과 hybrid 검색을 같은 모델에서 비교합니다.

```bash
cd backend/ai-service
source .venv/bin/activate
python -m evals.run --cases evals/golden.jsonl --modes both
```

자세한 데이터 형식과 보고서 위치는 [AI 평가 안내](../backend/ai-service/evals/README.md)를 따릅니다.

### 배포 계약

```bash
docker compose --env-file deploy/.env.production.example config --quiet
```

운영 환경의 OAuth callback, WAF와 백업·복구 절차는 [Ubuntu 24.04 배포 안내](ubuntu-24.04-deployment.md)에서 확인합니다.

## 증거 기록 형식

파일럿 또는 포트폴리오에 결과를 옮길 때 아래 정보를 함께 기록합니다.

```text
검증일:
기준 commit:
환경:
데이터 세트:
모델과 설정:
실행 명령:
통과한 시나리오:
실패한 시나리오와 원인:
보고서·로그 위치:
```

수치는 기준 commit과 보고서가 함께 있는 경우에만 사용합니다. 테스트 개수는 작성한 테스트 수와 저장소 전체 통과 수를 구분하고, AI 품질 수치는 데이터 세트·모델·평가 방식과 함께 기록합니다.

## 데이터 처리 원칙

- Jira·Confluence 원문은 사내 위키용 RAG 색인에 복제하지 않습니다.
- 원문 접근은 요청 시점의 사용자 OAuth 권한을 사용합니다.
- AI 서비스에는 DLP·PII 처리를 통과한 최소 발췌만 전달합니다.
- 임시 원문 발췌는 암호화해 제한된 시간만 보관합니다.
- 장기 보관 데이터는 마스킹된 브리프, Evidence 식별자·Version과 게시 상태로 제한합니다.
- 로그에는 OAuth token, 원문 전체, 비밀정보와 마스킹 전 PII를 남기지 않습니다.

## 파일럿 진행 기준

다음 조건이 모두 충족되면 제한된 사용자 범위에서 파일럿을 진행할 수 있습니다.

1. AUTH, FRESH, DLP, CITE, READY, PUB, WEBHOOK, RET 시나리오가 기준 환경에서 통과합니다.
2. 실패한 게시를 재시도했을 때 중복 외부 변경이 발생하지 않습니다.
3. 권한 밖 원문과 마스킹 전 민감정보가 API 응답, 로그와 장기 저장소에 남지 않습니다.
4. AI 검색·생성 평가 결과가 기준 commit과 보고서로 재현됩니다.
5. 배포, OAuth callback, 백업과 복구 절차를 운영 문서대로 재현할 수 있습니다.
