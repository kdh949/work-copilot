from fastapi import FastAPI
from pydantic import BaseModel

from app.services.embedding_service import preview_embedding
from app.services.indexing_service import index_url, preview_index_url
from app.services.vector_store import preview_init_vector_tables

# FastAPI 앱을 만듭니다.
# 이 앱이 AI 전용 서버의 입구 역할을 합니다.
app = FastAPI(title="JG Mentor AI Server")


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


@app.post("/db/init")
async def db_init():
    # RAG에 필요한 DB 테이블을 만듭니다.
    # 이미 있으면 새로 만들지 않고 그대로 통과합니다.
    return await preview_init_vector_tables()
