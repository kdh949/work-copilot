# Work Copilot Backend

Work Copilot의 NestJS 백엔드입니다. Keycloak OIDC 로그인, 회사 위키, 개인 노트, 댓글, 태그, 검색, 페이징을 제공합니다.

회사 위키 문서를 작성하거나 수정하면 FastAPI AI 서비스의 `/documents` API로 문서를 보내 RAG 검색 자료로 사용합니다.

## 실행 순서

```bash
cp .env.example .env
npm install
npm run start:dev
```

Postgres는 루트 폴더에서 실행할 수 있습니다.

```bash
docker compose -f compose.dev.yaml up -d
```

## 주요 API

- `GET /auth/oidc/login`: Keycloak OIDC 로그인 시작
- `GET /auth/oidc/callback`: Keycloak OIDC callback
- `POST /auth/logout`: 세션 로그아웃
- `GET /auth/me`: 내 정보
- `GET /posts?boardType=wiki`: 회사 위키 목록, 검색, 페이징
- `POST /posts`: 회사 위키 작성, 관리자만 가능
- `GET /posts/notes/my`: 내가 작성한 노트 목록
- `POST /posts/notes`: 개인 노트 작성
- `PATCH /posts/:id`: 회사 위키 또는 개인 노트 수정
- `DELETE /posts/:id`: 회사 위키 또는 개인 노트 삭제
- `POST /posts/:id/comments`: 댓글 작성
- `PATCH /posts/:postId/comments/:commentId`: 댓글 수정
- `DELETE /posts/:postId/comments/:commentId`: 댓글 삭제
- `POST /ai/chat`: RAG 챗봇
- `POST /ai/onboarding`: 부서별 온보딩 추천
- `POST /ai/lecture`: 강의안 생성
- `POST /ai/agent`: Agent 실행
- `GET /brief-drafts/:id/publication-preview`: Confluence 게시 대상, 부모 페이지, 본문, 인용 근거 미리보기
- `POST /brief-drafts/:id/publish`: 승인한 Confluence 페이지 생성
- `GET /brief-drafts/:id/publication/:publicationId/jira-preview`: Jira 링크·댓글 미리보기
- `POST /brief-drafts/:id/publication/:publicationId/jira`: 승인한 Jira remote link·요약 댓글 반영
- `GET /brief-drafts/:id/publication/:publicationId/child-tasks-preview`: 선택한 하위 작업과 createmeta 점검 결과 미리보기
- `POST /brief-drafts/:id/publication/:publicationId/child-tasks`: 승인한 하위 작업 생성
- `POST /brief-drafts/:id/publication/:publicationId/retry`: 같은 단계 idempotency key로 실패한 항목만 복구

## 환경변수

- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`: Postgres 연결 정보
- `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_REDIRECT_URI`: Keycloak OIDC 설정
- `KEYCLOAK_ALLOWED_EMAIL_DOMAINS`: 쉼표로 구분한 허용 회사 이메일 도메인
- `OIDC_ATTEMPT_ENCRYPTION_KEY`: base64 32-byte OIDC PKCE verifier 암호화 키
- `SESSION_TTL_SECONDS`: 300~86400초 범위의 BFF 세션 수명
- `INTEGRATION_ENCRYPTION_KEY`: base64 32-byte integration client secret·사용자 OAuth token 암호화 키
- `INTEGRATION_CALLBACK_BASE_URL`: 사용자 OAuth callback을 만들 API HTTPS base URL
- `INTEGRATION_BASE_URL_HOST_ALLOWLIST`: 쉼표로 구분한 Jira·Confluence HTTPS hostname allowlist
- `INTEGRATION_JIRA_SCOPE_ALLOWLIST`, `INTEGRATION_CONFLUENCE_SCOPE_ALLOWLIST`: 프로필에서 선택 가능한 최소 OAuth scope 목록
- `AI_SERVICE_URL`: FastAPI AI 서비스 주소
- `TRUST_PROXY_HOPS`: WAF와 Nginx 앞단을 신뢰하는 프록시 홉 수. 운영 Compose는 `2`, API 직접 로컬 개발은 `0`

### Jira·Confluence 프로필 저장 전 운영 설정

운영 환경에서는 `INTEGRATION_BASE_URL_HOST_ALLOWLIST`가 비어 있으면 보안상
프로필을 저장할 수 없습니다. Jira와 Confluence의 **hostname만** 쉼표로 구분해
설정합니다. URL의 `https://`, 경로, 포트는 포함하지 않습니다.

```dotenv
INTEGRATION_BASE_URL_HOST_ALLOWLIST=jira.example.com,confluence.example.com
INTEGRATION_JIRA_SCOPE_ALLOWLIST=READ
INTEGRATION_CONFLUENCE_SCOPE_ALLOWLIST=READ
```

프로필의 OAuth scope는 각 provider의 해당 allowlist에 있는 값만 사용할 수 있습니다.
관리자 화면은 허용 목록 미설정, URL host 불일치, scope 불일치를 안전한 오류 코드와
함께 구분해 안내합니다.

### 실제 Jira·Confluence 게시 설정

기본 어댑터는 실제 사용자 OAuth 토큰으로만 쓰기 요청을 보냅니다. 실제 게시를 켜려면
각 provider allowlist와 활성 연동 프로필에 `WRITE`를 포함하고, 기존 사용자는 OAuth를
다시 연결해야 합니다. scope 구성이 바뀐 이전 grant는 읽기에는 계속 사용할 수 있어도
쓰기에 승격되지 않습니다.

```dotenv
INTEGRATION_JIRA_SCOPE_ALLOWLIST=READ,WRITE
INTEGRATION_CONFLUENCE_SCOPE_ALLOWLIST=READ,WRITE
PUBLICATION_WRITE_MODE=real
PUBLICATION_ATLASSIAN_OAUTH_CONTRACT=verified
```

`PUBLICATION_WRITE_MODE`를 생략하면 쓰기를 수행하지 않는 `mock` 어댑터를 사용합니다.
실제 외부 쓰기는 `real`을 명시했을 때만 활성화되며, `mokc` 같은 알 수 없는 값은
애플리케이션 시작을 실패시킵니다. 또한 `real` 모드는 대상 Data Center 버전의 사용자
OAuth2 staging contract를 통과한 뒤에만 `PUBLICATION_ATLASSIAN_OAUTH_CONTRACT=verified`로
켜야 합니다. 계약 실행 방법과 필수 endpoint는
[`docs/atlassian-dc-oauth-contract.md`](../docs/atlassian-dc-oauth-contract.md)에 정리했습니다.

각 외부 쓰기 단계는 별도의 미리보기와 사용자 승인을 요구하며, 모든 `POST` 요청에는
`Idempotency-Key`가 필요합니다. 같은 키로 재시도하면 성공한 단계는 건너뜁니다.
Confluence 단계는 페이지 ID·버전·URL·content hash·요청자·요청 시각을 보존하고, 이후
Jira 링크/댓글과 선택된 하위 작업을 순서대로 처리합니다.

추천 Confluence 근거는 Jira 키와 요약에서 만든 metadata 검색 결과만 사용합니다. 문서
본문은 추천 또는 모델 지시로 취급하지 않으며, 게시 본문은 서버 렌더러가 이스케이프합니다.

Jira·Confluence Data Center OAuth Provider API는 OpenID Connect discovery를 제공하지
않습니다. 연동은 각 base URL의 `/rest/oauth2/latest/authorize` 및
`/rest/oauth2/latest/token` 경로를 사용합니다.

## 권한

- Keycloak ID token의 `work-copilot-admin` claim이 있는 사용자만 관리자 권한을 가집니다.
- 일반 사용자는 회사 위키를 조회하고 본인 노트만 작성, 수정, 삭제할 수 있습니다.
