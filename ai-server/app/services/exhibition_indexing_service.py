import re
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.services.embedding_service import get_embedding
from app.services.indexing_service import chunk_text, guess_title, make_content_hash
from app.services.vector_store import save_indexed_document


BASE_URL = "https://jungle.krafton.com"


def clean_lines(text: str) -> str:
    # 여러 줄의 글에서 빈 줄과 앞뒤 공백을 정리합니다.
    # 사람이 읽기 쉬운 텍스트로 만든 뒤 vector DB에 넣기 위해서입니다.
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)


def extract_detail_urls(html: str) -> list[str]:
    # 목록 페이지에서 /news/105 같은 상세 페이지 링크만 모읍니다.
    # 같은 링크가 여러 번 나오면 한 번만 남깁니다.
    soup = BeautifulSoup(html, "html.parser")
    urls: list[str] = []
    seen: set[str] = set()

    for link in soup.select("a[href]"):
        href = link.get("href", "")
        if not re.fullmatch(r"/news/\d+", href):
            continue

        url = urljoin(BASE_URL, href)
        if url in seen:
            continue

        seen.add(url)
        urls.append(url)

    return urls


def extract_cloudfront_image_urls(html: str) -> list[str]:
    # 상세 페이지 HTML 안에서 cloudfront 이미지 URL만 찾습니다.
    # 영상 mp4는 제외하고, png/jpg/jpeg/webp 같은 이미지 파일만 사용합니다.
    urls: list[str] = []
    seen: set[str] = set()
    pattern = r"https://d2h4gp3ie0wqu6\.cloudfront\.net/articles/(?:attachments|images)/[^\"'\\\s]+"

    for match in re.finditer(pattern, html):
        url = match.group(0).rstrip("\\")
        if not re.search(r"\.(png|jpg|jpeg|webp)(\?|$)", url, re.IGNORECASE):
            continue

        if url in seen:
            continue

        seen.add(url)
        urls.append(url)

    return urls


def extract_page_text(html: str) -> str:
    # 상세 페이지에 HTML 텍스트가 있으면 같이 저장합니다.
    # 이미지 OCR만 믿지 않고, 제목/카테고리 같은 기본 텍스트도 함께 보관합니다.
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    return clean_lines(soup.get_text(separator="\n"))


async def fetch_html(url: str) -> str:
    # 웹페이지 HTML을 가져옵니다.
    # 상세 페이지와 목록 페이지 모두 이 함수를 사용합니다.
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 JG-Mentor-Exhibition-Indexer"},
        )

    response.raise_for_status()
    return response.text


async def collect_exhibition_detail_urls(start_page: int = 1, end_page: int = 4) -> list[str]:
    # 프로젝트 전시회 목록 1~4페이지를 돌면서 상세 페이지 URL을 모읍니다.
    detail_urls: list[str] = []
    seen: set[str] = set()

    for page in range(start_page, end_page + 1):
        html = await fetch_html(f"{BASE_URL}/news/exhibitions?page={page}")

        for url in extract_detail_urls(html):
            if url in seen:
                continue

            seen.add(url)
            detail_urls.append(url)

    return detail_urls


async def extract_image_text_with_vision(
    title: str,
    page_url: str,
    image_urls: list[str],
) -> str:
    # OpenAI vision 모델로 이미지 안의 텍스트와 프로젝트 설명을 읽습니다.
    # 한 상세 페이지의 여러 이미지를 한 번에 보내서 프로젝트 내용을 정리합니다.
    if not settings.openai_api_key or not image_urls:
        return ""

    llm = ChatOpenAI(
        model=settings.openai_vision_model,
        api_key=settings.openai_api_key,
        temperature=0,
    )

    content = [
        {
            "type": "text",
            "text": (
                "아래 이미지는 크래프톤 정글 프로젝트 전시회 상세 페이지의 이미지입니다.\n"
                "이미지 안에 보이는 텍스트를 최대한 그대로 추출하고, "
                "프로젝트명, 문제 정의, 핵심 기능, 기술 스택, 결과물을 한국어로 정리해 주세요.\n"
                "보이지 않는 내용은 추측하지 말고 '확인 불가'라고 적어 주세요.\n"
                f"페이지 제목: {title}\n"
                f"페이지 URL: {page_url}"
            ),
        }
    ]

    for image_url in image_urls[:8]:
        # 한 페이지에 이미지가 너무 많으면 비용과 시간이 커집니다.
        # 그래서 상세 페이지당 최대 8장까지만 Vision 모델에 보냅니다.
        content.append({"type": "image_url", "image_url": {"url": image_url}})

    try:
        message = await llm.ainvoke([HumanMessage(content=content)])
        return str(message.content)
    except Exception as error:
        # Vision 권한이나 모델 접근이 없으면 여기로 옵니다.
        # 인덱싱 전체를 멈추지 않고, 어떤 이유로 이미지 분석이 실패했는지 문서에 남깁니다.
        return f"이미지 Vision 추출 실패: {error}"


async def index_exhibition_detail(url: str) -> dict:
    # 상세 페이지 하나를 인덱싱합니다.
    # HTML 텍스트 + 이미지에서 추출한 텍스트를 합쳐서 document/chunk로 저장합니다.
    html = await fetch_html(url)
    page_text = extract_page_text(html)
    image_urls = extract_cloudfront_image_urls(html)
    title = guess_title(page_text, url)
    vision_text = await extract_image_text_with_vision(title, url, image_urls)
    content = clean_lines(
        "\n\n".join(
            [
                title,
                f"URL: {url}",
                "HTML 텍스트:",
                page_text,
                "이미지 Vision 추출 텍스트:",
                vision_text or "이미지에서 추출한 텍스트 없음",
                "이미지 URL:",
                "\n".join(image_urls),
            ]
        )
    )
    chunks = chunk_text(content)
    embeddings = []

    for chunk in chunks:
        embeddings.append(await get_embedding(chunk))

    saved = await save_indexed_document(
        title=title,
        content=content,
        source_type="OFFICIAL_EXHIBITION",
        source_url=url,
        content_hash=make_content_hash(content),
        chunks=chunks,
        embeddings=embeddings,
        discovered_by="official_exhibition_vision",
        search_keyword="크래프톤 정글 프로젝트 전시회 이미지 Vision 인덱싱",
    )

    return {
        "url": url,
        "title": title,
        "imageCount": len(image_urls),
        "textLength": len(content),
        "chunkCount": len(chunks),
        **saved,
    }


async def index_exhibition_pages(start_page: int = 1, end_page: int = 4) -> dict:
    # 전시회 목록 페이지를 돌며 상세 페이지를 모두 인덱싱합니다.
    # 한 상세 페이지가 실패해도 나머지 페이지는 계속 진행합니다.
    detail_urls = await collect_exhibition_detail_urls(start_page, end_page)
    indexed: list[dict] = []
    failed: list[dict] = []

    for url in detail_urls:
        try:
            indexed.append(await index_exhibition_detail(url))
        except Exception as error:
            failed.append({"url": url, "error": str(error)})

    return {
        "status": "ok",
        "startPage": start_page,
        "endPage": end_page,
        "detailUrlCount": len(detail_urls),
        "indexedCount": len(indexed),
        "failedCount": len(failed),
        "indexed": indexed,
        "failed": failed,
    }
