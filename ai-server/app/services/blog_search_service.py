import asyncio
import html
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx
from bs4 import BeautifulSoup

from app.core.config import settings
from app.services.indexing_service import index_url


def clean_search_text(text: str) -> str:
    # 검색 결과 제목에는 <b> 같은 HTML 태그가 섞일 수 있습니다.
    # 태그를 지우고 사람이 읽는 글자만 남깁니다.
    soup = BeautifulSoup(text or "", "html.parser")
    return html.unescape(soup.get_text(" ", strip=True))


def normalize_duckduckgo_url(href: str) -> str | None:
    # DuckDuckGo 검색 결과 링크는 진짜 주소를 감싸고 있을 때가 있습니다.
    # /l/?uddg=https%3A%2F%2F... 같은 모양이면 안쪽의 진짜 URL만 꺼냅니다.
    if not href:
        return None

    if href.startswith("/l/"):
        parsed = urlparse(href)
        real_url = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(real_url) if real_url else None

    if href.startswith(("http://", "https://")):
        return href

    return None


def dedupe_search_results(results: list[dict]) -> list[dict]:
    # 같은 URL이 여러 번 나오면 한 번만 남깁니다.
    # 이미 본 URL은 seen에 적어두고, 처음 보는 URL만 keep에 넣습니다.
    seen: set[str] = set()
    keep: list[dict] = []

    for result in results:
        url = result["url"]
        if url in seen:
            continue

        seen.add(url)
        keep.append(result)

    return keep


async def search_duckduckgo_blogs(keyword: str, limit: int) -> list[dict]:
    # DuckDuckGo HTML 검색 페이지에서 블로그 URL을 찾습니다.
    # 공식 API는 아니지만, API key 없이 최소 구현을 할 때 쓰기 좋습니다.
    query = f"{keyword} 블로그"
    search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        response = await client.get(
            search_url,
            headers={"User-Agent": "Mozilla/5.0 JG-Mentor-Blog-Search"},
        )

    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    results: list[dict] = []

    # DuckDuckGo HTML 결과에서 제목 링크를 하나씩 읽습니다.
    for link in soup.select("a.result__a"):
        url = normalize_duckduckgo_url(link.get("href", ""))
        if not url:
            continue

        host = urlparse(url).netloc.lower()
        if "duckduckgo.com" in host:
            continue

        results.append(
            {
                "title": clean_search_text(link.get_text(" ", strip=True)),
                "url": url,
                "keyword": keyword,
                "provider": "duckduckgo",
            }
        )

        if len(results) >= limit:
            break

    return dedupe_search_results(results)


async def search_naver_blogs(keyword: str, limit: int) -> list[dict]:
    # Naver Blog Search API로 블로그 글을 찾습니다.
    # NAVER_CLIENT_ID/SECRET이 없으면 사용할 수 없어서 빈 목록을 돌려줍니다.
    if not settings.naver_client_id or not settings.naver_client_secret:
        return []

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            "https://openapi.naver.com/v1/search/blog.json",
            params={"query": keyword, "display": limit, "sort": "date"},
            headers={
                "X-Naver-Client-Id": settings.naver_client_id,
                "X-Naver-Client-Secret": settings.naver_client_secret,
            },
        )

    response.raise_for_status()
    data = response.json()
    results: list[dict] = []

    for item in data.get("items", []):
        results.append(
            {
                "title": clean_search_text(item.get("title", "")),
                "url": item.get("link", ""),
                "keyword": keyword,
                "provider": "naver_api",
            }
        )

    return dedupe_search_results([result for result in results if result["url"]])


async def discover_blog_urls(keyword: str, limit: int | None = None) -> list[dict]:
    # 키워드 하나를 받아서 어떤 검색기를 쓸지 고릅니다.
    # naver_api는 Naver API key가 있을 때 쓰고, 없거나 결과가 없으면 DuckDuckGo를 써봅니다.
    max_results = limit or settings.blog_search_max_results

    if settings.blog_search_mode == "off":
        return []

    if settings.blog_search_mode == "naver_api":
        naver_results = await search_naver_blogs(keyword, max_results)
        if naver_results:
            return naver_results

    return await search_duckduckgo_blogs(keyword, max_results)


async def sync_blogs_by_keywords(
    keywords: list[str] | None = None,
    limit: int | None = None,
) -> dict:
    # 여러 키워드로 블로그를 검색하고, 찾은 URL을 기존 RAG 인덱싱 함수에 넣습니다.
    # 흐름: 키워드 검색 -> URL 찾기 -> 본문 가져오기 -> chunk -> embedding -> DB 저장
    target_keywords = keywords or settings.blog_sync_queries
    indexed: list[dict] = []
    failed: list[dict] = []

    for keyword in target_keywords:
        search_results = await discover_blog_urls(keyword, limit)

        for result in search_results:
            try:
                saved = await index_url(
                    url=result["url"],
                    source_type="BLOG",
                    discovered_by=result["provider"],
                    search_keyword=keyword,
                )
                indexed.append({**result, **saved})
            except Exception as error:
                # 한 블로그가 실패해도 전체 작업이 멈추지 않게 실패 목록에만 적습니다.
                failed.append(
                    {
                        **result,
                        "error": str(error),
                    }
                )

            # 너무 빠르게 여러 블로그를 요청하지 않도록 잠깐 쉽니다.
            await asyncio.sleep(0.5)

    return {
        "status": "ok",
        "keywords": target_keywords,
        "indexedCount": len(indexed),
        "failedCount": len(failed),
        "indexed": indexed,
        "failed": failed,
    }
