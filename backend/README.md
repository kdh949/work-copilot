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
docker compose up -d
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

## 권한

- Keycloak ID token의 `work-copilot-admin` claim이 있는 사용자만 관리자 권한을 가집니다.
- 일반 사용자는 회사 위키를 조회하고 본인 노트만 작성, 수정, 삭제할 수 있습니다.
