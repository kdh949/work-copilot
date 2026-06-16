import hashlib
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from langchain_text_splitters import RecursiveCharacterTextSplitter
from readability import Document

from app.services.embedding_service import get_embedding
from app.services.github_mcp_service import fetch_github_repository_text, parse_github_repo_url
from app.services.vector_store import save_indexed_document


# 사용자가 입력한 URL을 컴퓨터가 읽기 좋은 형태로 고칩니다.
# 예: "blog.naver.com/abc" -> "https://blog.naver.com/abc"
def normalize_url(url: str) -> str:
    # 앞뒤 빈칸을 지웁니다.
    trimmed = url.strip()

    # 아무것도 입력하지 않았다면 오류를 냅니다.
    if not trimmed:
        raise ValueError("URL is empty")

    # http:// 또는 https://가 없으면 https://를 붙입니다.
    if not trimmed.startswith(("http://", "https://")):
        trimmed = f"https://{trimmed}"

    # URL을 조각내서 진짜 주소처럼 생겼는지 확인합니다.
    parsed = urlparse(trimmed)

    # netloc은 "example.com" 같은 사이트 주소 부분입니다.
    if not parsed.netloc:
        raise ValueError("Invalid URL")

    return trimmed


# URL 페이지를 열어서 HTML 안의 본문 글만 뽑아냅니다.
# RAG는 긴 웹페이지 전체가 아니라, 깨끗한 글 텍스트가 필요합니다.
async def fetch_url_text(url: str) -> str:
    # GitHub repo URL이면 일반 웹페이지 추출 대신 GitHub API로 README를 가져옵니다.
    # 이렇게 해야 메뉴/버튼 같은 HTML 노이즈를 줄이고 진짜 repo 설명을 저장할 수 있습니다.
    if parse_github_repo_url(url):
        return await fetch_github_repository_text(url)

    # 웹페이지를 가져오는 HTTP 클라이언트입니다.
    # redirect가 있으면 따라가고, 15초 넘게 걸리면 멈춥니다.
    async with httpx.AsyncClient(timeout=15.0,
                                 follow_redirects=True) as client:
        response = await client.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 JG-Mentor-AI-Indexer",
            },
        )

    # 404, 500 같은 실패 응답이면 여기서 오류를 냅니다.
    response.raise_for_status()

    html = response.text

    # readability는 HTML에서 광고/메뉴를 빼고 본문에 가까운 부분을 찾아줍니다.
    doc = Document(html)
    title = doc.short_title()
    content_html = doc.summary()

    # BeautifulSoup은 HTML 태그를 다루기 쉽게 만들어줍니다.
    soup = BeautifulSoup(content_html, "html.parser")

    # 글 내용이 아닌 script/style 같은 부분은 제거합니다.
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    # HTML 태그를 없애고 사람이 읽는 텍스트만 남깁니다.
    text = soup.get_text(separator="\n")

    # 빈 줄과 앞뒤 공백을 정리합니다.
    # text.splitlines()는 문자열을 줄 단위로 나눠서 리스트로 만들어주는 파이썬 함수
    cleaned_lines = [
        line.strip() for line in text.splitlines() if line.strip()
    ]
    cleaned_text = "\n".join(cleaned_lines)

    # 제목이 있으면 제목도 본문 앞에 붙입니다.
    if title:
        return f"{title}\n\n{cleaned_text}"

    return cleaned_text


# 긴 글을 작은 조각(chunk)으로 나눕니다.
# 나중에 질문과 가장 비슷한 chunk만 찾아서 LLM에게 줄 수 있습니다.
def chunk_text(text: str,
               chunk_size: int = 900,
               chunk_overlap: int = 150) -> list[str]:
    # LangChain의 RecursiveCharacterTextSplitter를 사용합니다.
    # 긴 글을 문단 -> 줄 -> 문장 -> 글자 순서로 자연스럽게 쪼개주는 도구입니다.
    # 직접 자르는 코드를 줄이고, RAG에서 자주 쓰는 검증된 방식으로 바꿉니다.
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", "? ", "! ", "다. ", "요. ", " ", ""],
    )

    # split_text는 긴 문자열을 작은 chunk 리스트로 바꿉니다.
    return [chunk.strip() for chunk in splitter.split_text(text) if chunk.strip()]


# URL을 실제 vector DB에 저장하기 전에 미리 확인하는 함수입니다.
# 지금 단계에서는 "가져오기 + 자르기"까지만 테스트합니다.
async def preview_index_url(url: str, source_type: str = "BLOG") -> dict:
    # 1. URL 모양을 정리합니다.
    normalized_url = normalize_url(url)

    # 2. URL에서 본문 텍스트를 가져옵니다.
    text = await fetch_url_text(normalized_url)

    # 3. 본문을 작은 chunk로 나눕니다.
    chunks = chunk_text(text)

    # 4. 저장하지 않고, 잘 나뉘었는지만 보여줍니다.
    return {
        "url": normalized_url,
        "sourceType": source_type,
        "textLength": len(text),
        "chunkCount": len(chunks),
        "previewChunks": chunks[:2],
    }


def make_content_hash(content: str) -> str:
    # 글 내용이 같은지 비교하기 위해 짧은 지문 같은 값을 만듭니다.
    # 같은 글이면 항상 같은 hash가 나오고, 글이 바뀌면 hash도 바뀝니다.
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def guess_title(text: str, fallback_url: str) -> str:
    # 본문 첫 줄을 제목처럼 사용합니다.
    # 첫 줄이 비어 있으면 URL을 제목 대신 사용합니다.
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return first_line[:200] if first_line else fallback_url


async def index_url(
    url: str,
    source_type: str = "BLOG",
    discovered_by: str = "manual",
    search_keyword: str | None = None,
) -> dict:
    # 실제 인덱싱 함수입니다.
    # URL을 읽고, 글을 chunk로 나누고, embedding을 만든 뒤, DB에 저장합니다.

    # 1. URL 모양을 정리합니다.
    normalized_url = normalize_url(url)

    # 2. URL에서 본문 텍스트를 가져옵니다.
    text = await fetch_url_text(normalized_url)

    # 3. 본문 제목과 hash를 만듭니다.
    title = guess_title(text, normalized_url)
    content_hash = make_content_hash(text)

    # 4. 본문을 작은 chunk로 나눕니다.
    chunks = chunk_text(text)

    # 5. 각 chunk를 embedding 숫자 벡터로 바꿉니다.
    embeddings = []
    for chunk in chunks:
        embeddings.append(await get_embedding(chunk))

    # 6. 문서와 chunk들을 vector DB에 저장합니다.
    saved = await save_indexed_document(
        title=title,
        content=text,
        source_type=source_type,
        source_url=normalized_url,
        content_hash=content_hash,
        chunks=chunks,
        embeddings=embeddings,
        discovered_by=discovered_by,
        search_keyword=search_keyword,
    )

    # 7. API 응답으로 저장 결과를 알려줍니다.
    return {
        "url": normalized_url,
        "title": title,
        "sourceType": source_type,
        "textLength": len(text),
        "contentHash": content_hash,
        **saved,
    }
