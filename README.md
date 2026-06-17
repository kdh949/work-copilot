# DH Company Wiki Backend

NestJS 게시판 백엔드입니다. 회원가입, 로그인, 게시글 CRUD, 댓글, 태그, 검색, 페이징을 제공합니다.

게시글을 작성하거나 수정하면 FastAPI AI 서비스의 `/documents` API로 문서를 보내 RAG 검색 자료로 사용합니다.

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
- `GET /posts`: 게시글 목록, 검색, 페이징
- `POST /posts`: 게시글 작성
- `GET /posts/questions/my`: 내가 작성한 질문 노트 목록
- `POST /posts/questions`: 질문 노트 작성 후 AI 답변 댓글 자동 생성
- `PATCH /posts/:id`: 게시글 수정
- `DELETE /posts/:id`: 게시글 삭제
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
