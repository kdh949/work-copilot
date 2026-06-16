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

    # GitHub 공개 repo를 읽을 때 사용할 token입니다.
    # 비어 있어도 공개 repo는 읽을 수 있지만, token이 있으면 요청 제한에 덜 걸립니다.
    github_token: str = os.getenv("GITHUB_TOKEN", "")

    # PostgreSQL + pgvector DB에 접속할 주소입니다.
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://jungle:jungle@localhost:5432/jungleboard",
    )


# 다른 파일에서 settings.openai_api_key처럼 꺼내 쓸 수 있게 만든 객체입니다.
settings = Settings()
