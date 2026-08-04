# Work Copilot

> **Jira 이슈와 Confluence 지식을, 출처와 승인 조건이 있는 업무 브리프로 바꾸는 AI 코파일럿**

Work Copilot은 사용자가 실제로 접근할 수 있는 Jira·Confluence 자료만 읽어 업무 브리프를 만들고, 근거의 버전과 출처를 연결한 뒤 검토와 명시적 승인 후에만 외부 시스템에 반영합니다.

[포트폴리오 사례](https://dhkim.cloud/work-copilot) · [파일럿 검증 기준](docs/pilot-readiness.md) · [AI 평가 안내](backend/ai-service/evals/README.md) · [배포 안내](docs/ubuntu-24.04-deployment.md)

`React` `TypeScript` `NestJS` `FastAPI` `PostgreSQL + pgvector` `Keycloak OIDC` `OpenAI`

## 30초 요약

| 항목 | 내용 |
| --- | --- |
| 해결할 문제 | 새 업무를 맡을 때 Jira 이슈, Confluence 문서, 정책과 이전 논의를 여러 화면에서 다시 조합해야 했습니다. |
| 제품 흐름 | 근거 선택 → DLP·PII 처리 → Citation 브리프 생성 → 최신성·필수 조건 확인 → 사용자 승인 → 멱등 게시 |
| 구현 범위 | 개인 프로젝트로 제품 구조, React Web, NestJS BFF·API, FastAPI AI 서비스, 데이터 모델, 테스트와 배포 구성을 설계·구현했습니다. |
| 핵심 판단 | Jira·Confluence 원문을 전역 RAG에 복제하지 않고, 요청 시점의 사용자 OAuth 권한으로 원천 시스템에서 조회합니다. |
| 외부 변경 경계 | 생성과 게시를 분리하고, 승인·최신성·DLP·Idempotency 조건을 통과한 요청만 Jira에 반영합니다. |
| 검증 방식 | 권한 차이, 근거 버전 변경, 민감정보, 중복 요청과 부분 실패를 자동 테스트와 파일럿 시나리오로 확인합니다. |

## 사용 과정

| 단계 | 사용자가 하는 일 | 시스템이 하는 일 |
| --- | --- | --- |
| 1. 이슈 선택 | 작업할 Jira 이슈를 고릅니다. | 현재 사용자의 Atlassian OAuth로 이슈와 연결 문서를 조회합니다. |
| 2. 근거 검토 | 사용할 Jira·Confluence 자료를 선택합니다. | Provider ID, URL, Version과 최소 발췌를 Evidence로 연결합니다. |
| 3. 브리프 생성 | 선택한 근거로 초안을 만듭니다. | DLP·PII 처리를 거친 입력으로 요구사항, 위험, 하위 작업 초안을 생성하고 각 항목에 Citation을 붙입니다. |
| 4. 게시 준비 확인 | 누락된 내용과 차단 조건을 확인합니다. | 필수 필드, Citation, Blocker, 근거 최신성을 읽기 전용으로 점검합니다. |
| 5. 승인·게시 | 사용자가 변경 내용을 승인합니다. | Idempotency-Key와 단계별 상태를 사용해 Jira 변경을 실행하고 실패한 단계만 다시 처리합니다. |

## 중요한 설계 판단

### 1. 서비스 로그인과 원문 접근 권한을 분리했습니다

Keycloak은 Work Copilot의 사용자 세션을 담당하고, Jira·Confluence 원문은 사용자별 Atlassian OAuth 연결로 조회합니다. 서비스에 로그인했다고 해서 조직의 모든 문서를 읽을 수 없으며, 원천 시스템에서 허용한 자료만 Evidence 후보가 됩니다.

### 2. 유사도뿐 아니라 문서의 권한과 Version을 근거에 포함했습니다

브리프의 각 결과 항목은 Evidence ID와 연결됩니다. Evidence에는 Provider 식별자, 원문 URL, Version과 최소 발췌가 포함됩니다. 권한을 잃거나 Version이 바뀐 근거는 다시 검토해야 하므로, 오래된 초안을 그대로 게시하지 않습니다.

### 3. AI 입력과 장기 보관 데이터를 나눴습니다

- Jira·Confluence 원문은 사내 위키용 RAG 색인에 넣지 않습니다.
- 비밀정보 차단과 한국어 PII 마스킹을 거친 최소 발췌만 AI 서비스로 전달합니다.
- 필요한 원문 발췌는 암호화해 최대 24시간 보관합니다.
- 장기 보관 대상은 마스킹된 브리프와 근거 식별자·Version, 게시 상태입니다.

### 4. 생성과 외부 변경을 별도 상태로 관리했습니다

Draft 생성, Readiness 확인, Publication을 분리했습니다. 외부 쓰기는 사용자 승인, 최신성 확인과 DLP 검사를 통과한 경우에만 실행합니다. 같은 Idempotency-Key로 요청이 반복돼도 중복 변경을 만들지 않고, 일부 하위 작업이 실패하면 성공한 단계는 유지한 채 실패 지점부터 다시 처리합니다.

## 아키텍처

```mermaid
flowchart LR
    U["사용자"] --> W["React Web"]
    W -->|"HttpOnly session + CSRF"| API["NestJS API / BFF"]
    API <-->|"OIDC + PKCE"| KC["Keycloak"]
    API <-->|"사용자별 OAuth"| J["Jira"]
    API <-->|"사용자별 OAuth"| C["Confluence"]
    J -->|"변경 신호"| WH["Webhook Ingress"]
    C -->|"변경 신호"| WH
    WH --> API
    API -->|"DLP 통과 최소 발췌"| AI["FastAPI AI Service"]
    AI --> OAI["OpenAI"]
    API --> DB[("PostgreSQL")]
    API -. "사내 위키 전용" .-> RAG["pgvector RAG"]
```

| 영역 | 구성 |
| --- | --- |
| Web | React 19, Vite, TypeScript |
| API·BFF | NestJS 11, TypeORM, PostgreSQL |
| AI | FastAPI, LangChain, OpenAI, pgvector 하이브리드 검색 |
| 인증·보안 | Keycloak OIDC Authorization Code + PKCE, HttpOnly session, CSRF·Origin 검증, AES-256-GCM |
| 연동·운영 | Jira·Confluence OAuth, Webhook freshness, idempotent publication saga, Docker Compose, Sophos WAF |

<details>
<summary><strong>함께 구현한 업무 공간 기능</strong></summary>

- 부서·태그·키워드로 탐색하는 회사 위키 트리와 댓글
- 개인 노트 작성·수정·삭제와 AI 답변 저장
- 위키 기반 RAG 챗봇, 부서별 온보딩 추천, 교육 강의안 생성
- 관리자용 연동 프로필·연결 상태·AI 동기화 운영 화면

</details>

## 검증

### 코드와 계약

```bash
npm run build
npm test
docker compose --env-file deploy/.env.production.example config --quiet
```

AI 서비스 단위 테스트:

```bash
cd backend/ai-service
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m unittest discover -s tests -p 'test_*.py'
```

권한 차이, 근거 Version 변경, DLP, Citation, 중복 게시와 부분 게시 실패를 포함한 파일럿 시나리오는 [파일럿 검증 기준](docs/pilot-readiness.md)에 정리했습니다.

### AI 검색 평가

Golden Set의 실제 `sourceId`를 기준으로 baseline과 hybrid 검색을 같은 데이터·모델에서 비교합니다.

```bash
cd backend/ai-service
source .venv/bin/activate
python -m evals.run --cases evals/golden.jsonl --modes both
```

평가 데이터 형식과 보고서 생성 방법은 [AI 평가 안내](backend/ai-service/evals/README.md)를 따릅니다.

## 빠른 시작

### 요구 사항

- Node.js 22
- npm 10 이상
- Python 3.12
- Docker Compose

### 설치와 환경 파일

```bash
npm ci
cp backend/.env.example backend/.env
cp backend/ai-service/.env.example backend/ai-service/.env
cp frontend/.env.example frontend/.env

cd backend/ai-service
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ../..
```

### 데이터베이스와 서비스 실행

```bash
docker compose -f compose.dev.yaml up -d
npm run migration:run --workspace=backend
```

각 서비스는 별도 터미널에서 실행합니다.

```bash
npm run dev:backend
```

```bash
cd backend/ai-service
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

```bash
npm run dev:frontend
```

| 서비스 | 로컬 주소 |
| --- | --- |
| Web | `http://localhost:5173` |
| API | `http://localhost:3000` |
| AI service | `http://localhost:8000` |

## 환경 변수와 데이터 보호

`*.env.example`에는 필요한 변수 이름과 안전한 예시만 둡니다. 실제 비밀값은 배포 환경의 secret 또는 권한이 제한된 `.env`에서 관리합니다.

| 목적 | 주요 변수 |
| --- | --- |
| 서비스 로그인 | `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `OIDC_ATTEMPT_ENCRYPTION_KEY` |
| Jira·Confluence 연동 | `INTEGRATION_ENCRYPTION_KEY`, `INTEGRATION_CALLBACK_BASE_URL`, provider scope allowlist |
| AI 서비스 보호 | `AI_SERVICE_URL`, `AI_SERVICE_API_KEY`, `OPENAI_API_KEY` |
| 임시 원문 보관 | `TRANSIENT_CONTENT_ENCRYPTION_KEY`, `TRANSIENT_EVIDENCE_TTL_SECONDS` |

관리자 권한은 Keycloak의 `work-copilot-admin` claim으로 판정합니다. `AI_SERVICE_API_KEY`는 NestJS와 FastAPI에 같은 값으로 설정하며 OpenAI 키와 분리해 관리합니다.

## 배포

운영 서비스는 Ubuntu 24.04 서버의 Docker Compose로 실행합니다. Sophos WAF가 `https://work-copilot.dhkim.cloud:443`을 종료하고 서버의 사설 IP `:7236`으로 전달합니다. Web과 API는 같은 도메인에서 제공되며 API 경로는 `/api`입니다.

```bash
cp deploy/.env.production.example .env.production
chmod 600 .env.production
# 실제 비밀값과 서버 사설 IP를 입력한 뒤 실행
docker compose --env-file .env.production up --build -d
```

OAuth callback, WAF, 백업과 복구 절차는 [Ubuntu 24.04 배포 안내](docs/ubuntu-24.04-deployment.md)를 참고하세요.

## 저장소 구성

```text
.
├── backend/                 # NestJS BFF, 위키·노트·연동·브리프 API
│   └── ai-service/          # FastAPI RAG, DLP, 브리프 생성 서비스
├── frontend/                # React + Vite 업무 공간
├── docs/                    # 설계, 검증 기준, 배포 문서
├── compose.yaml             # Ubuntu 단일 서버 전체 배포
├── compose.dev.yaml         # 개발용 PostgreSQL + pgvector
└── deploy/                  # 운영 환경 예제와 백업 timer
```

## 문서

- [파일럿 검증 기준](docs/pilot-readiness.md)
- [백엔드 API와 환경 변수](backend/README.md)
- [AI 서비스와 위키 데이터 적재](backend/ai-service/README.md)
- [AI 평가 안내](backend/ai-service/evals/README.md)
- [Ubuntu 24.04 단일 서버 배포](docs/ubuntu-24.04-deployment.md)
- [업무 코파일럿 구현 계획](docs/jira-confluence-work-copilot-implementation-plan.md)
