import asyncio
import html
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx
from bs4 import BeautifulSoup

from app.core.config import settings
from app.services.indexing_service import index_url


BLOG_HOST_HINTS = (
    "blog.naver.com",
    "m.blog.naver.com",
    "tistory.com",
    "velog.io",
    "medium.com",
    "github.io",
)


def normalize_result_url(url: str) -> str:
    # 같은 글인데 주소 끝의 / 때문에 다르게 보이는 경우가 있습니다.
    # 비교할 때는 끝의 /를 빼서 같은 주소로 알아보게 합니다.
    return url.strip().rstrip("/")


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

    # //duckduckgo.com/l/?... 처럼 https:가 빠진 주소도 실제 URL처럼 바꿉니다.
    if href.startswith("//"):
        href = f"https:{href}"

    parsed = urlparse(href)

    # DuckDuckGo가 감싼 링크라면 uddg 안의 진짜 블로그 URL을 꺼냅니다.
    if href.startswith("/l/") or (
        "duckduckgo.com" in parsed.netloc.lower() and parsed.path.startswith("/l/")
    ):
        real_url = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(real_url) if real_url else None

    if href.startswith(("http://", "https://")):
        return href

    return None


def make_duckduckgo_query(keyword: str) -> str:
    # 키워드에 이미 "블로그"가 있으면 또 붙이지 않습니다.
    # 예: "크래프톤 정글 후기 블로그" -> 그대로 검색
    # 예: "크래프톤 정글 후기" -> "크래프톤 정글 후기 블로그"로 검색
    if "블로그" in keyword:
        return keyword

    return f"{keyword} 블로그"


def is_blog_like_url(url: str) -> bool:
    # 검색 결과 중 블로그일 가능성이 큰 주소만 우선 사용합니다.
    # 이렇게 하면 뉴스/광고/검색 페이지가 vector DB에 들어갈 확률을 줄일 수 있습니다.
    host = urlparse(url).netloc.lower()

    if "duckduckgo.com" in host:
        return False

    return any(hint in host for hint in BLOG_HOST_HINTS)


def collect_duckduckgo_links(soup: BeautifulSoup, keyword: str) -> list[dict]:
    # DuckDuckGo는 상황에 따라 HTML 모양이 조금씩 다릅니다.
    # 그래서 여러 선택자를 차례대로 보면서 검색 결과 링크를 모읍니다.
    links = soup.select("a.result__a")

    if not links:
        links = soup.select("a.result-link")

    if not links:
        links = soup.select("a[href]")

    results: list[dict] = []

    for link in links:
        url = normalize_duckduckgo_url(link.get("href", ""))
        if not url or not is_blog_like_url(url):
            continue

        title = clean_search_text(link.get_text(" ", strip=True))
        if not title:
            title = url

        results.append(
            {
                "title": title,
                "url": url,
                "keyword": keyword,
                "provider": "duckduckgo",
            }
        )

    return dedupe_search_results(results)


def dedupe_search_results(results: list[dict]) -> list[dict]:
    # 같은 URL이 여러 번 나오면 한 번만 남깁니다.
    # 이미 본 URL은 seen에 적어두고, 처음 보는 URL만 keep에 넣습니다.
    seen: set[str] = set()
    keep: list[dict] = []

    for result in results:
        url = normalize_result_url(result["url"])
        if url in seen:
            continue

        seen.add(url)
        result["url"] = url
        keep.append(result)

    return keep


async def search_all_blog_providers(keyword: str, limit: int) -> list[dict]:
    # Naver와 DuckDuckGo를 둘 다 검색해서 결과를 합칩니다.
    # 같은 URL은 한 번만 남기고, 본문이 같은 글은 DB 저장 단계에서 한 번 더 걸러집니다.
    provider_results = await asyncio.gather(
        search_naver_blogs(keyword, limit),
        search_duckduckgo_blogs(keyword, limit),
        return_exceptions=True,
    )

    all_results: list[dict] = []

    for result in provider_results:
        # 한 검색기가 실패해도 다른 검색기 결과는 계속 사용합니다.
        # 예: Naver API key가 틀려도 DuckDuckGo 결과는 인덱싱할 수 있습니다.
        if isinstance(result, Exception):
            continue

        all_results.extend(result)

    # limit은 검색기 하나당 가져올 개수입니다.
    # 그래서 all 모드에서는 Naver 결과와 DuckDuckGo 결과를 합친 뒤 중복 URL만 제거합니다.
    return dedupe_search_results(all_results)


async def search_duckduckgo_blogs(keyword: str, limit: int) -> list[dict]:
    # DuckDuckGo HTML 검색 페이지에서 블로그 URL을 찾습니다.
    # 공식 API는 아니지만, API key 없이 최소 구현을 할 때 쓰기 좋습니다.
    query = make_duckduckgo_query(keyword)
    encoded_query = quote_plus(query)
    search_urls = [
        f"https://html.duckduckgo.com/html/?q={encoded_query}",
        f"https://lite.duckduckgo.com/lite/?q={encoded_query}",
    ]

    results: list[dict] = []

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        for search_url in search_urls:
            response = await client.get(
                search_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; JG-Mentor-Blog-Search)",
                },
            )
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")
            results = collect_duckduckgo_links(soup, keyword)

            # 첫 번째 주소에서 결과를 못 찾으면 lite 주소를 한 번 더 시도합니다.
            if results:
                break

    return dedupe_search_results(results)[:limit]


async def preview_duckduckgo_search(keyword: str, limit: int = 5) -> dict:
    # DB에 저장하지 않고 DuckDuckGo 검색 결과만 확인하는 테스트 함수입니다.
    # "검색이 되는지"와 "파서가 URL을 잘 찾는지"를 빠르게 볼 때 씁니다.
    results = await search_duckduckgo_blogs(keyword, limit)

    return {
        "keyword": keyword,
        "resultCount": len(results),
        "results": results,
    }


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
    # all이면 Naver와 DuckDuckGo를 둘 다 검색해서 합칩니다.
    max_results = limit or settings.blog_search_max_results

    if settings.blog_search_mode == "off":
        return []

    if settings.blog_search_mode == "all":
        return await search_all_blog_providers(keyword, max_results)

    if settings.blog_search_mode == "naver_api":
        return await search_naver_blogs(keyword, max_results)

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
