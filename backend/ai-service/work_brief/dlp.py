"""Deterministic DLP protections for the work-brief boundary.

The standard-library validators are deliberately retained even when Presidio is
installed: Korean resident and business registration numbers need checksum
validation before they are masked.  Presidio recognizers add a compatible
analysis layer when the optional runtime dependency is present.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Iterable

try:
    from presidio_analyzer import Pattern, PatternRecognizer
except ImportError:  # Unit tests may run before optional AI dependencies exist.
    Pattern = None
    PatternRecognizer = None


class DlpBlockedError(ValueError):
    """A secret or a blocking policy was found; its value is never exposed."""


class DlpConfigurationError(ValueError):
    """A custom rule is malformed or would expand the DLP attack surface."""


EMAIL_PATTERN = re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9.-])")
PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+82[- ]?)?0?1[0-9][- ]?\d{3,4}[- ]?\d{4}(?!\d)")
KOREAN_RESIDENT_NUMBER_PATTERN = re.compile(r"(?<!\d)\d{6}[- ]?\d{7}(?!\d)")
KOREAN_BUSINESS_NUMBER_PATTERN = re.compile(r"(?<!\d)\d{3}[- ]?\d{2}[- ]?\d{5}(?!\d)")
# Korean driver license numbers use a stable 2-2-6-2 segmented format. Keep
# separators mandatory so an unrelated sequence of digits is not masked.
KOREAN_DRIVER_LICENSE_PATTERN = re.compile(r"(?<!\d)\d{2}[- ]\d{2}[- ]\d{6}[- ]\d{2}(?!\d)")
CARD_NUMBER_PATTERN = re.compile(r"(?<!\d)(?:\d{4}[- ]?){3}\d{4}(?!\d)")
# A numeric account is only treated as PII when the writer explicitly labels
# it as an account. This avoids classifying arbitrary ticket or build numbers.
BANK_ACCOUNT_LABEL_PATTERN = re.compile(
    r"(?:계좌(?:번호)?|은행\s*계좌|bank\s+account)\s*[:：]?\s*(?P<value>\d{2,6}(?:[- ]?\d{2,6}){1,3})",
    re.IGNORECASE,
)
# Addresses vary too much for an unlabelled Korean regex. A labelled, single
# line address with Korean administrative/street markers is a high-confidence
# detector and preserves text around the address.
ADDRESS_LABEL_PATTERN = re.compile(
    r"(?:주소|address)\s*[:：]\s*(?P<value>[^\r\n.!?]{5,120})(?=$|[.!?\r\n])",
    re.IGNORECASE,
)

SECRET_PATTERNS = (
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b", re.IGNORECASE),
    re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b"),
    re.compile(r"-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----"),
    re.compile(r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'\"`]+", re.IGNORECASE),
    re.compile(r"(?:^|[\r\n])\s*[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DB_URI)\s*=", re.MULTILINE),
    re.compile(r"\b(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9_./+=-]{8,}", re.IGNORECASE),
    re.compile(r"(?:^|[/:])\.env(?:[./:]|$)", re.IGNORECASE),
)

RULE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
CLASSIFICATION_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")


@dataclass(frozen=True)
class SafeCustomRule:
    """A literal-only custom rule.

    Arbitrary regular expressions are intentionally unsupported.  Literal
    matching has bounded linear behaviour and avoids regex denial of service.
    """

    name: str
    classification: str
    action: str
    literal: str


@dataclass
class PlaceholderContext:
    placeholders: dict[tuple[str, str], str] = field(default_factory=dict)
    counters: dict[str, int] = field(default_factory=dict)

    def get(self, entity_type: str, value: str) -> str:
        key = (entity_type, value)
        if key not in self.placeholders:
            index = self.counters.get(entity_type, 0) + 1
            self.counters[entity_type] = index
            self.placeholders[key] = f"[{entity_type}_{index}]"
        return self.placeholders[key]


@dataclass(frozen=True)
class DlpMatch:
    start: int
    end: int
    entity_type: str
    value: str


def load_safe_custom_rules(serialized_rules: str | None) -> list[SafeCustomRule]:
    """Load bounded literal rules without persisting or logging their samples."""

    if not serialized_rules:
        return []

    try:
        raw_rules = json.loads(serialized_rules)
    except json.JSONDecodeError as error:
        raise DlpConfigurationError("Custom DLP rules are invalid.") from error

    if not isinstance(raw_rules, list) or len(raw_rules) > 32:
        raise DlpConfigurationError("Custom DLP rules are invalid.")

    parsed: list[SafeCustomRule] = []
    for raw_rule in raw_rules:
        if not isinstance(raw_rule, dict) or set(raw_rule) != {
            "name",
            "classification",
            "action",
            "literal",
        }:
            raise DlpConfigurationError("Custom DLP rules are invalid.")

        name = raw_rule["name"]
        classification = raw_rule["classification"]
        action = raw_rule["action"]
        literal = raw_rule["literal"]
        if (
            not isinstance(name, str)
            or not RULE_NAME_PATTERN.fullmatch(name)
            or not isinstance(classification, str)
            or not CLASSIFICATION_PATTERN.fullmatch(classification)
            or action not in {"block", "mask"}
            or not isinstance(literal, str)
            or not 2 <= len(literal) <= 128
            or any(ord(character) < 32 for character in literal)
        ):
            raise DlpConfigurationError("Custom DLP rules are invalid.")

        parsed.append(SafeCustomRule(name, classification, action, literal))

    return parsed


def assert_no_secret(value: str) -> None:
    if any(pattern.search(value) for pattern in SECRET_PATTERNS):
        raise DlpBlockedError("Sensitive content cannot be processed.")


def is_valid_korean_resident_number(value: str) -> bool:
    digits = value.replace("-", "").replace(" ", "")
    if len(digits) != 13 or not digits.isdigit():
        return False

    weighted_sum = sum(
        int(digit) * weight
        for digit, weight in zip(digits[:12], (2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5))
    )
    return (11 - weighted_sum % 11) % 10 == int(digits[12])


def is_valid_korean_business_number(value: str) -> bool:
    digits = value.replace("-", "").replace(" ", "")
    if len(digits) != 10 or not digits.isdigit():
        return False

    weights = (1, 3, 7, 1, 3, 7, 1, 3, 5)
    weighted_sum = sum(int(digit) * weight for digit, weight in zip(digits[:9], weights))
    weighted_sum += (int(digits[8]) * 5) // 10
    return (10 - weighted_sum % 10) % 10 == int(digits[9])


def is_valid_card_number(value: str) -> bool:
    """Use Luhn validation before masking a card-like 16-digit value."""

    digits = value.replace("-", "").replace(" ", "")
    if len(digits) != 16 or not digits.isdigit():
        return False

    total = 0
    for index, digit in enumerate(reversed(digits)):
        number = int(digit)
        if index % 2 == 1:
            number *= 2
            if number > 9:
                number -= 9
        total += number
    return total % 10 == 0


def is_likely_korean_address(value: str) -> bool:
    return bool(re.search(r"[가-힣]+(?:시|도|구|군|읍|면|동|로|길)", value))


class KoreanPiiRedactor:
    """Masks PII consistently inside one work-brief request."""

    def __init__(self, custom_rules: Iterable[SafeCustomRule] = ()) -> None:
        self._custom_rules = tuple(custom_rules)
        self._presidio_recognizers = self._build_presidio_recognizers()

    def new_context(self) -> PlaceholderContext:
        return PlaceholderContext()

    def sanitize(self, value: str, context: PlaceholderContext) -> str:
        assert_no_secret(value)
        matches = self._find_pii_matches(value)

        for rule in self._custom_rules:
            starts_at = 0
            while True:
                index = value.find(rule.literal, starts_at)
                if index < 0:
                    break
                if rule.action == "block":
                    raise DlpBlockedError("Sensitive content cannot be processed.")
                matches.append(
                    DlpMatch(index, index + len(rule.literal), rule.classification, rule.literal),
                )
                starts_at = index + len(rule.literal)

        return self._replace_matches(value, matches, context)

    def _find_pii_matches(self, value: str) -> list[DlpMatch]:
        matches: list[DlpMatch] = []
        patterns = (
            ("EMAIL", EMAIL_PATTERN, lambda _: True),
            ("PHONE", PHONE_PATTERN, lambda _: True),
            ("KR_RRN", KOREAN_RESIDENT_NUMBER_PATTERN, is_valid_korean_resident_number),
            ("KR_BUSINESS_NUMBER", KOREAN_BUSINESS_NUMBER_PATTERN, is_valid_korean_business_number),
            ("KR_DRIVER_LICENSE", KOREAN_DRIVER_LICENSE_PATTERN, lambda _: True),
            ("CARD", CARD_NUMBER_PATTERN, is_valid_card_number),
        )
        for entity_type, pattern, validator in patterns:
            for candidate in pattern.finditer(value):
                if validator(candidate.group(0)):
                    matches.append(
                        DlpMatch(candidate.start(), candidate.end(), entity_type, candidate.group(0)),
                    )

            # Presidio pattern recognizers are used as a second detector when
            # installed.  The deterministic candidates above stay authoritative
            # for Korean checksum validation and for dependency-light test runs.
            recognizer = self._presidio_recognizers.get(entity_type)
            if recognizer:
                try:
                    results = recognizer.analyze(value, [entity_type], None)
                except Exception:
                    results = []
                for result in results:
                    detected_value = value[result.start:result.end]
                    if validator(detected_value):
                        matches.append(
                            DlpMatch(result.start, result.end, entity_type, detected_value),
                        )

        for candidate in BANK_ACCOUNT_LABEL_PATTERN.finditer(value):
            account = candidate.group("value")
            if 10 <= len(account.replace("-", "").replace(" ", "")) <= 16:
                start, end = candidate.span("value")
                matches.append(DlpMatch(start, end, "BANK_ACCOUNT", account))

        for candidate in ADDRESS_LABEL_PATTERN.finditer(value):
            address = candidate.group("value").strip()
            if is_likely_korean_address(address):
                start, end = candidate.span("value")
                matches.append(DlpMatch(start, end, "ADDRESS", address))

        return matches

    def _replace_matches(
        self,
        value: str,
        matches: Iterable[DlpMatch],
        context: PlaceholderContext,
    ) -> str:
        selected: list[DlpMatch] = []
        for match in sorted(matches, key=lambda item: (item.start, -(item.end - item.start), item.entity_type)):
            if selected and match.start < selected[-1].end:
                continue
            selected.append(match)

        if not selected:
            return value

        output: list[str] = []
        cursor = 0
        for match in selected:
            output.append(value[cursor:match.start])
            output.append(context.get(match.entity_type, match.value))
            cursor = match.end
        output.append(value[cursor:])
        return "".join(output)

    def _build_presidio_recognizers(self) -> dict[str, object]:
        if Pattern is None or PatternRecognizer is None:
            return {}

        try:
            return {
                "EMAIL": PatternRecognizer(
                    supported_entity="EMAIL",
                    patterns=[Pattern("work_brief_email", EMAIL_PATTERN.pattern, 0.85)],
                ),
                "PHONE": PatternRecognizer(
                    supported_entity="PHONE",
                    patterns=[Pattern("work_brief_phone", PHONE_PATTERN.pattern, 0.85)],
                ),
                "KR_RRN": PatternRecognizer(
                    supported_entity="KR_RRN",
                    patterns=[Pattern("work_brief_kr_rrn", KOREAN_RESIDENT_NUMBER_PATTERN.pattern, 0.85)],
                ),
                "KR_BUSINESS_NUMBER": PatternRecognizer(
                    supported_entity="KR_BUSINESS_NUMBER",
                    patterns=[Pattern("work_brief_kr_business", KOREAN_BUSINESS_NUMBER_PATTERN.pattern, 0.85)],
                ),
            }
        except Exception:
            return {}
