# AI Service

FastAPI로 만든 회사 위키 AI 서비스입니다.

- `/documents`: NestJS 게시글을 RAG 문서로 저장
- `/chat`: 위키 기반 질의응답
- `/onboarding`: 부서별 신입 온보딩 추천
- `/lecture`: 부서별 교육 강의안 생성
- `/mcp`: JSON-RPC MCP 서버
- `/agent/run`: 간단한 도구 선택 Agent 실행

## 실행

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

`OPENAI_API_KEY`가 있으면 LangChain으로 OpenAI 모델과 임베딩을 사용합니다. 키가 없으면 게시글 내용을 바탕으로 간단한 로컬 응답을 반환합니다.

## 위키 더미 데이터 적재

로컬 zip 파일을 검증한 뒤 Render Postgres 외부 URL로 직접 적재합니다.

```bash
python scripts/import_wiki_dataset.py --dry-run
WIKI_IMPORT_DATABASE_URL="postgresql://..." OPENAI_API_KEY="..." python scripts/import_wiki_dataset.py
```

로컬 Docker Postgres에서만 OpenAI 없이 테스트하려면 `--allow-fake-embeddings`를 사용할 수 있습니다.

```bash
python scripts/import_wiki_dataset.py --allow-fake-embeddings
python scripts/import_wiki_dataset.py --rollback
```
