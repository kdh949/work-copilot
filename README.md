# Jira–Confluence Work Copilot

Jira와 Confluence를 연결해 회사 지식, AI 온보딩 챗봇, 개인 노트를 제공하는 모노리포입니다.

## 구성

- `backend`: NestJS API와 FastAPI AI 서비스
- `frontend`: React + Vite 프론트엔드
- `docker-compose.yml`: pgvector가 포함된 로컬 PostgreSQL
- `render.yaml`: Render API, AI, 정적 사이트 구성

## 요구 사항

- Node.js 22
- npm 10 이상
- Python 3.12
- Docker Compose

## 설치

루트에서 두 Node.js workspace 의존성을 한 번에 설치합니다.

```bash
npm ci
```

AI 서비스는 별도의 Python 가상환경을 사용합니다.

```bash
cd backend/ai-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 로컬 실행

PostgreSQL을 먼저 실행합니다.

```bash
docker compose up -d
```

각 서비스의 환경 파일을 준비합니다.

```bash
cp backend/.env.example backend/.env
cp backend/ai-service/.env.example backend/ai-service/.env
cp frontend/.env.example frontend/.env
```

서로 다른 터미널에서 서비스를 실행합니다.

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

첫 번째 가입자는 `admin`, 이후 가입자는 `employee` 역할을 받습니다.

## 검증

```bash
npm run build
npm test
docker compose config
```

AI 서비스 단위 테스트와 실제 모델 평가 도구는 다음과 같이 실행합니다.

```bash
cd backend/ai-service
source .venv/bin/activate
python -m unittest discover -s tests -p 'test_*.py'
```

`AI_SERVICE_API_KEY`는 NestJS와 AI 서비스에 같은 비밀값으로 설정해야 합니다. 이 값과 OpenAI 키는 `.env`에만 보관하며 저장소에 포함하지 않습니다.

1,000개 위키를 적재한 뒤 실제 `sourceId`로 Golden Set을 채우면 기준선과 하이브리드 검색을 같은 모델에서 비교할 수 있습니다. 자세한 형식과 실행 명령은 [Evals 안내](backend/ai-service/evals/README.md)를 참고하세요.

## 배포

- API: `https://work-copilot-api.onrender.com`
- AI: `https://work-copilot-ai.onrender.com`
- 프론트엔드: `https://work-copilot-web.onrender.com`

Render는 루트 `render.yaml`을 사용하며 `main` 브랜치 변경을 자동 배포합니다.
운영 데이터베이스는 Supabase PostgreSQL의 Shared Pooler session endpoint를 사용합니다.
Render와 Supabase 사이의 데이터베이스 연결은 TLS를 강제합니다.

## 이전 커밋 이력

백엔드와 프론트엔드의 기존 커밋 SHA는 재작성하지 않고 `main`의 병합 부모로 보존했습니다. 기존 팀 브랜치의 끝은 `legacy/*-tip` 태그에서 확인할 수 있습니다.
