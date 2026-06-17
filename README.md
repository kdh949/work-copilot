# DH Company Wiki Backend

NestJS 게시판 백엔드입니다. 회원가입, 로그인, 회사 위키, 개인 노트, 댓글, 태그, 검색, 페이징을 제공합니다.

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

- `POST /auth/signup`: 회원가입
- `POST /auth/login`: 로그인
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
- `JWT_SECRET`, `JWT_EXPIRES_IN`: 로그인 토큰 설정
- `AI_SERVICE_URL`: FastAPI AI 서비스 주소

## 권한

- 첫 번째로 가입한 사용자는 `admin`입니다.
- 그 이후 가입한 사용자는 `employee`입니다.
- `admin`은 회사 위키를 작성, 수정, 삭제할 수 있습니다.
- `employee`는 회사 위키를 조회하고 본인 노트만 작성, 수정, 삭제할 수 있습니다.
