import asyncio
from contextlib import suppress

from fastapi import FastAPI
from pydantic import BaseModel

from app.core.config import settings
from app.services.agent_service import agent_ask
from app.services.blog_search_service import sync_blogs_by_keywords
from app.services.embedding_service import get_embedding, preview_embedding
from app.services.github_mcp_service import analyze_github_repository
from app.services.indexing_service import index_url, preview_index_url
from app.services.vector_store import preview_init_vector_tables, search_similar_chunks

# FastAPI 앱을 만듭니다.
# 이 앱이 AI 전용 서버의 입구 역할을 합니다.
app = FastAPI(title="JG Mentor AI Server")

# 서버가 켜져 있는 동안 24시간마다 돌아갈 블로그 동기화 작업입니다.
# 처음에는 비어 있고, BLOG_SYNC_ENABLED=true일 때만 시작합니다.
blog_sync_task: asyncio.Task | None = None


class IndexUrlPreviewRequest(BaseModel):
    # 사용자가 인덱싱하고 싶은 블로그/GitHub 주소입니다.
    url: str
    # 이 URL이 어떤 종류의 자료인지 표시합니다. 지금은 기본값을 BLOG로 둡니다.
    source_type: str = "BLOG"


class IndexUrlRequest(BaseModel):
    # 실제 vector DB에 저장하고 싶은 블로그/GitHub 주소입니다.
    url: str
    # BLOG, GITHUB, BOARD처럼 자료의 종류를 표시합니다.
    source_type: str = "BLOG"
    # 이 URL을 어떻게 찾았는지 표시합니다. 직접 입력이면 manual입니다.
    discovered_by: str = "manual"
    # 나중에 키워드 검색 자동화로 찾은 URL이면 검색 키워드를 여기에 넣습니다.
    search_keyword: str | None = None


class EmbeddingPreviewRequest(BaseModel):
    # 숫자 벡터로 바꿔보고 싶은 문장입니다.
    text: str


class SearchRequest(BaseModel):
    # 사용자가 궁금해하는 질문입니다.
    # 이 질문을 embedding으로 바꾼 뒤, 비슷한 chunk를 DB에서 찾습니다.
    question: str
    # 검색 결과를 몇 개까지 가져올지 정합니다.
    limit: int = 5


class AskRequest(BaseModel):
    # 사용자가 AI 멘토에게 묻는 질문입니다.
    question: str
    # LLM 답변에 참고시킬 자료를 몇 개까지 찾을지 정합니다.
    limit: int = 5
    # GitHub repo를 직접 분석하고 싶을 때 넣는 URL입니다.
    repository_url: str | None = None


class GithubAnalyzeRequest(BaseModel):
    # 분석하고 싶은 GitHub repository 주소입니다.
    repository_url: str


class BlogSyncRequest(BaseModel):
    # 직접 검색하고 싶은 키워드 목록입니다.
    # 비워두면 .env의 BLOG_SYNC_QUERIES를 사용합니다.
    keywords: list[str] | None = None
    # 키워드 하나당 검색 결과를 몇 개까지 가져올지 정합니다.
    limit: int | None = None


async def run_periodic_blog_sync():
    # 서버가 켜져 있는 동안 같은 일을 반복하는 함수입니다.
    # 한 번 검색/인덱싱하고, 정해진 시간만큼 쉬고, 다시 실행합니다.
    while True:
        try:
            await sync_blogs_by_keywords()
        except Exception as error:
            # 자동 작업에서 오류가 나도 서버 전체가 꺼지면 안 됩니다.
            print(f"[blog-sync] failed: {error}")

        # 기본값은 24시간입니다.
        await asyncio.sleep(settings.blog_sync_interval_hours * 60 * 60)


@app.on_event("startup")
async def start_blog_sync():
    # .env에서 BLOG_SYNC_ENABLED=true로 켜면 자동 블로그 검색을 시작합니다.
    global blog_sync_task

    if settings.blog_sync_enabled:
        blog_sync_task = asyncio.create_task(run_periodic_blog_sync())


@app.on_event("shutdown")
async def stop_blog_sync():
    # 서버가 꺼질 때 자동 작업도 같이 멈춥니다.
    if not blog_sync_task:
        return

    blog_sync_task.cancel()
    with suppress(asyncio.CancelledError):
        await blog_sync_task


@app.get("/health")
def health():
    # 서버가 살아있는지 확인하는 가장 간단한 API입니다.
    return {"status": "ok"}


@app.post("/index-url/preview")
async def index_url_preview(req: IndexUrlPreviewRequest):
    # 실제 DB에 저장하기 전에 URL에서 글을 잘 가져오고,
    # 잘게 나눌 수 있는지 미리 확인합니다.
    return await preview_index_url(
        url=req.url,
        source_type=req.source_type,
    )


@app.post("/index-url")
async def index_url_api(req: IndexUrlRequest):
    # URL을 실제로 vector DB에 저장합니다.
    # 흐름: URL 읽기 -> 본문 추출 -> chunking -> embedding -> DB 저장
    return await index_url(
        url=req.url,
        source_type=req.source_type,
        discovered_by=req.discovered_by,
        search_keyword=req.search_keyword,
    )


@app.post("/embedding/preview")
async def embedding_preview(req: EmbeddingPreviewRequest):
    # 문장을 embedding 숫자 목록으로 바꿀 수 있는지 확인합니다.
    # 아직 DB에는 저장하지 않고, 앞부분 숫자만 보여줍니다.
    return await preview_embedding(req.text)


@app.post("/search")
async def search(req: SearchRequest):
    # RAG 검색 API입니다.
    # 1. 질문을 embedding 숫자 벡터로 바꿉니다.
    question_embedding = await get_embedding(req.question)

    # 2. vector DB에서 질문과 가장 비슷한 chunk를 찾습니다.
    results = await search_similar_chunks(
        question_embedding=question_embedding,
        limit=req.limit,
    )

    # 3. 찾은 chunk들을 응답으로 돌려줍니다.
    # 아직 LLM 답변 생성은 하지 않고, "자료 찾기"까지만 합니다.
    return {
        "question": req.question,
        "resultCount": len(results),
        "results": results,
    }


@app.post("/ask")
async def ask(req: AskRequest):
    # RAG 답변 API입니다.
    # 모든 질문은 Agent를 거칩니다.
    # Agent가 RAG 검색, GitHub MCP 도구, 일반 LLM 중 무엇을 쓸지 고릅니다.
    return await agent_ask(
        question=req.question,
        limit=req.limit,
        repository_url=req.repository_url,
    )


@app.post("/mcp/github/analyze")
async def analyze_github(req: GithubAnalyzeRequest):
    # 참조 프로젝트의 GitHub MCP 분석 API에 해당합니다.
    # 실제 MCP stdio 대신 GitHub REST API adapter를 사용합니다.
    return await analyze_github_repository(req.repository_url)


@app.post("/blogs/sync")
async def sync_blogs(req: BlogSyncRequest):
    # 블로그 키워드 검색을 수동으로 한 번 실행하는 API입니다.
    # 자동 24시간 작업을 기다리지 않고 바로 테스트할 때 씁니다.
    return await sync_blogs_by_keywords(
        keywords=req.keywords,
        limit=req.limit,
    )


@app.post("/db/init")
async def db_init():
    # RAG에 필요한 DB 테이블을 만듭니다.
    # 이미 있으면 새로 만들지 않고 그대로 통과합니다.
    return await preview_init_vector_tables()
