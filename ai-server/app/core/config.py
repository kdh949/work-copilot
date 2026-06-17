import os

from dotenv import load_dotenv

# .env 파일에 적어둔 값을 Python에서 읽을 수 있게 준비합니다.
# 예: OPENAI_API_KEY=sk-...
load_dotenv()


class Settings:
    # OpenAI API key입니다.
    # 값이 비어 있으면 나중에 테스트용 mock embedding을 사용합니다.
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")

    # 문장을 숫자 벡터로 바꿀 때 사용할 embedding 모델 이름입니다.
    openai_embedding_model: str = os.getenv(
        "OPENAI_EMBEDDING_MODEL",
        "text-embedding-3-small",
    )

    # 나중에 답변을 생성할 때 사용할 LLM 모델 이름입니다.
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")

    # 이미지 안의 글자와 내용을 읽을 때 사용할 vision 모델 이름입니다.
    openai_vision_model: str = os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini")

    # GitHub 공개 repo를 읽을 때 사용할 token입니다.
    # 비어 있어도 공개 repo는 읽을 수 있지만, token이 있으면 요청 제한에 덜 걸립니다.
    github_token: str = os.getenv("GITHUB_TOKEN", "")

    # PostgreSQL + pgvector DB에 접속할 주소입니다.
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://jungle:jungle@localhost:5432/jungleboard",
    )

    # 블로그 검색 방식입니다.
    # all이면 Naver와 DuckDuckGo를 둘 다 쓰고, off이면 자동 검색을 끕니다.
    blog_search_mode: str = os.getenv("BLOG_SEARCH_MODE", "all")

    # 키워드 하나로 검색할 때 검색기 하나당 최대 몇 개의 블로그 URL을 가져올지 정합니다.
    blog_search_max_results: int = int(os.getenv("BLOG_SEARCH_MAX_RESULTS", "5"))

    # 서버가 켜져 있는 동안 24시간마다 자동 블로그 검색을 할지 정합니다.
    blog_sync_enabled: bool = os.getenv("BLOG_SYNC_ENABLED", "false").lower() == "true"

    # 자동 블로그 검색 주기입니다. 기본값은 24시간입니다.
    blog_sync_interval_hours: int = int(os.getenv("BLOG_SYNC_INTERVAL_HOURS", "24"))

    # 자동으로 검색할 크래프톤 정글 관련 키워드 목록입니다.
    # | 기호로 여러 키워드를 나눕니다.
    blog_sync_queries: list[str] = [
        query.strip()
        for query in os.getenv(
            "BLOG_SYNC_QUERIES",
            "크래프톤 정글 후기 블로그|크래프톤 정글 알고리즘 학습|크래프톤 정글 지원 후기|크래프톤 정글 입학 준비|크래프톤 정글 회고",
        ).split("|")
        if query.strip()
    ]

    # Naver Blog Search API를 쓸 때 필요한 값입니다.
    naver_client_id: str = os.getenv("NAVER_CLIENT_ID", "")
    naver_client_secret: str = os.getenv("NAVER_CLIENT_SECRET", "")


# 다른 파일에서 settings.openai_api_key처럼 꺼내 쓸 수 있게 만든 객체입니다.
settings = Settings()
