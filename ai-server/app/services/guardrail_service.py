import re
from collections.abc import Callable
from dataclasses import dataclass
from importlib import import_module
from typing import Any, cast

from app.core.config import settings


MODERATION_MODEL = "omni-moderation-latest"

BLOCKED_INPUT_MESSAGE = (
    "죄송하지만 이 요청은 안전 정책상 처리할 수 없습니다. "
    "크래프톤 정글, 학습, 프로젝트, GitHub 분석과 관련된 질문으로 바꿔주세요."
)

BLOCKED_OUTPUT_MESSAGE = (
    "죄송하지만 생성된 답변이 안전 기준을 통과하지 못해 제공할 수 없습니다. "
    "질문을 조금 더 구체적이고 안전한 방향으로 바꿔주세요."
)


@dataclass
class GuardrailResult:
    allowed: bool
    message: str | None = None
    reason: str | None = None
    categories: dict | None = None


PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"forget\s+(all\s+)?previous\s+instructions",
    r"system\s+prompt",
    r"developer\s+message",
    r"hidden\s+instruction",
    r"jailbreak",
    r"너의\s*시스템\s*프롬프트",
    r"시스템\s*프롬프트.*보여",
    r"이전\s*지시.*무시",
    r"개발자\s*메시지.*보여",
]

SECRET_PATTERNS = [
    r"sk-[A-Za-z0-9_-]{20,}",
    r"ghp_[A-Za-z0-9_]{20,}",
    r"github_pat_[A-Za-z0-9_]{20,}",
    r"AKIA[0-9A-Z]{16}",
    r"-----BEGIN\s+(RSA|OPENSSH|EC|PRIVATE)\s+KEY-----",
]

DANGEROUS_KEYWORDS = [
    "폭탄 제조",
    "마약 제조",
    "해킹 방법",
    "랜섬웨어",
    "악성코드",
    "피싱 사이트",
    "카드번호 생성",
]


def _get_async_openai() -> Callable[..., Any] | None:
    try:
        openai_module = import_module("openai")
    except ImportError:
        return None

    async_openai = getattr(openai_module, "AsyncOpenAI", None)
    return cast(Callable[..., Any] | None, async_openai)


def _matches_any(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return pattern
    return None


def _rule_based_input_check(question: str) -> GuardrailResult:
    if not question.strip():
        return GuardrailResult(
            allowed=False,
            message="질문을 입력해 주세요.",
            reason="empty_input",
        )

    if len(question) > 4000:
        return GuardrailResult(
            allowed=False,
            message="질문이 너무 깁니다. 핵심 내용만 줄여서 다시 입력해 주세요.",
            reason="input_too_long",
        )

    matched = _matches_any(PROMPT_INJECTION_PATTERNS, question)
    if matched:
        return GuardrailResult(
            allowed=False,
            message=BLOCKED_INPUT_MESSAGE,
            reason=f"prompt_injection:{matched}",
        )

    matched = _matches_any(SECRET_PATTERNS, question)
    if matched:
        return GuardrailResult(
            allowed=False,
            message="API key나 private key 같은 민감정보는 입력하지 말아 주세요.",
            reason=f"secret_leak:{matched}",
        )

    for keyword in DANGEROUS_KEYWORDS:
        if keyword in question:
            return GuardrailResult(
                allowed=False,
                message=BLOCKED_INPUT_MESSAGE,
                reason=f"dangerous_keyword:{keyword}",
            )

    return GuardrailResult(allowed=True, reason="rule_based_input_passed")


def _rule_based_output_check(answer: str) -> GuardrailResult:
    matched = _matches_any(SECRET_PATTERNS, answer)
    if matched:
        return GuardrailResult(
            allowed=False,
            message=BLOCKED_OUTPUT_MESSAGE,
            reason=f"secret_leak_output:{matched}",
        )

    return GuardrailResult(allowed=True, reason="rule_based_output_passed")


def _dump_categories(categories) -> dict:
    if hasattr(categories, "model_dump"):
        return categories.model_dump()

    try:
        return dict(categories)
    except TypeError:
        return {}


async def _moderate_text(text: str, blocked_message: str) -> GuardrailResult:
    if not settings.openai_api_key:
        return GuardrailResult(allowed=True, reason="moderation_skipped_no_api_key")

    async_openai = _get_async_openai()
    if async_openai is None:
        return GuardrailResult(allowed=True, reason="moderation_skipped_no_openai_sdk")

    client = async_openai(api_key=settings.openai_api_key)

    try:
        response = await client.moderations.create(
            model=MODERATION_MODEL,
            input=text,
        )
    except Exception:
        # Guardrail API 장애 때문에 서비스 전체가 멈추지 않게 fail-open 합니다.
        # 운영 환경에서는 logging/alerting을 붙이는 것이 좋습니다.
        return GuardrailResult(allowed=True, reason="moderation_failed_open")

    result = response.results[0]
    categories = _dump_categories(result.categories)

    if result.flagged:
        flagged_categories = [
            name for name, flagged in categories.items() if flagged
        ]
        return GuardrailResult(
            allowed=False,
            message=blocked_message,
            reason="openai_moderation_flagged",
            categories={"flagged": flagged_categories},
        )

    return GuardrailResult(
        allowed=True,
        reason="openai_moderation_passed",
        categories=categories,
    )


async def validate_user_input(question: str) -> GuardrailResult:
    rule_check = _rule_based_input_check(question)
    if not rule_check.allowed:
        return rule_check

    return await _moderate_text(question, BLOCKED_INPUT_MESSAGE)


async def validate_model_output(answer: str) -> GuardrailResult:
    rule_check = _rule_based_output_check(answer)
    if not rule_check.allowed:
        return rule_check

    return await _moderate_text(answer, BLOCKED_OUTPUT_MESSAGE)
