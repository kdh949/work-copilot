import json
import os
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from main import app
from work_brief.dlp import (
    DlpBlockedError,
    KoreanPiiRedactor,
    load_safe_custom_rules,
)
from work_brief.service import (
    WorkBriefError,
    WorkBriefGenerateRequest,
    WorkBriefSanitizeRequest,
    generate_work_brief,
    sanitize_work_brief_values,
)


def valid_model_response(output: dict) -> Mock:
    response = Mock()
    response.ok = True
    response.json.return_value = {"output_text": json.dumps(output, ensure_ascii=False)}
    return response


def citation(text: str, evidence_ids: list[str] | None = None) -> dict:
    return {"text": text, "evidenceIds": evidence_ids or ["jira:DEMO-1"]}


def model_output(**overrides: object) -> dict:
    """A schema v2 response that passes every structural check."""
    output = {
        "schemaVersion": 2,
        "title": citation("배포 준비"),
        "summary": citation("완료"),
        "keyPoints": [citation("검증 완료")],
        "acceptanceCriteria": [citation("검증 결과가 기록된다")],
        "risks": [citation("일정 확인")],
        "nextSteps": [citation("테스트 실행")],
        "childTasks": [
            {
                "summary": "검증 기록 추가",
                "text": "검증 결과를 이슈에 남긴다",
                "evidenceIds": ["jira:DEMO-1"],
            },
        ],
        "excludedEvidence": [],
    }
    output.update(overrides)
    return output


def all_strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for item in value.values() for text in all_strings(item)]
    if isinstance(value, list):
        return [text for item in value for text in all_strings(item)]
    return []


class KoreanPiiRedactorTests(unittest.TestCase):
    def test_masks_korean_pii_with_consistent_placeholders(self) -> None:
        redactor = KoreanPiiRedactor()
        context = redactor.new_context()
        text = (
            "담당자는 user@example.com, 전화는 010-1234-5678, "
            "주민번호는 900101-1234568, 사업자번호는 123-45-67891 입니다. "
            "user@example.com으로 다시 연락하세요."
        )

        masked = redactor.sanitize(text, context)

        self.assertIn("[EMAIL_1]", masked)
        self.assertEqual(masked.count("[EMAIL_1]"), 2)
        self.assertIn("[PHONE_1]", masked)
        self.assertIn("[KR_RRN_1]", masked)
        self.assertIn("[KR_BUSINESS_NUMBER_1]", masked)
        for raw_value in ("user@example.com", "010-1234-5678", "900101-1234568", "123-45-67891"):
            self.assertNotIn(raw_value, masked)

    def test_masks_additional_high_confidence_korean_pii_categories(self) -> None:
        redactor = KoreanPiiRedactor()
        context = redactor.new_context()
        text = (
            "운전면허 11-12-123456-12, 카드 4111-1111-1111-1111, "
            "계좌번호: 110-123-456789, 주소: 서울특별시 강남구 테헤란로 123"
        )

        masked = redactor.sanitize(text, context)

        self.assertIn("[KR_DRIVER_LICENSE_1]", masked)
        self.assertIn("[CARD_1]", masked)
        self.assertIn("[BANK_ACCOUNT_1]", masked)
        self.assertIn("[ADDRESS_1]", masked)
        for raw_value in (
            "11-12-123456-12",
            "4111-1111-1111-1111",
            "110-123-456789",
            "서울특별시 강남구 테헤란로 123",
        ):
            self.assertNotIn(raw_value, masked)

    def test_does_not_mask_unlabelled_ticket_numbers_as_bank_accounts(self) -> None:
        redactor = KoreanPiiRedactor()
        masked = redactor.sanitize(
            "배포 작업 번호는 110-123-456789 입니다.",
            redactor.new_context(),
        )

        self.assertIn("110-123-456789", masked)

    def test_custom_rules_are_literal_only_and_can_block(self) -> None:
        rules = load_safe_custom_rules(json.dumps([
            {
                "name": "restricted_label",
                "classification": "RESTRICTED",
                "action": "block",
                "literal": "TOP SECRET",
            },
        ]))
        redactor = KoreanPiiRedactor(rules)

        with self.assertRaises(DlpBlockedError):
            redactor.sanitize("TOP SECRET delivery plan", redactor.new_context())


class WorkBriefGenerationTests(unittest.TestCase):
    def request(self, evidence: str) -> WorkBriefGenerateRequest:
        return WorkBriefGenerateRequest(
            instruction="아래 근거로 실행 브리프를 만드세요. user@example.com에게 공유합니다.",
            evidence=[{"evidenceId": "jira:DEMO-1", "content": evidence}],
        )

    def test_sends_only_masked_input_to_tool_free_store_false_responses_api(self) -> None:
        raw_evidence = "담당자 user@example.com, 전화 010-1234-5678, 주민번호 900101-1234568"
        output = model_output(summary=citation("[EMAIL_1]과 검토합니다."))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
            with patch("work_brief.service.requests.post", return_value=valid_model_response(output)) as post:
                result = generate_work_brief(self.request(raw_evidence))

        request_payload = post.call_args.kwargs["json"]
        serialized_payload = json.dumps(request_payload, ensure_ascii=False)
        for raw_value in ("user@example.com", "010-1234-5678", "900101-1234568", "test-openai-key"):
            self.assertNotIn(raw_value, serialized_payload)
        self.assertTrue(request_payload["store"] is False)
        self.assertNotIn("tools", request_payload)
        self.assertEqual(request_payload["text"]["format"]["type"], "json_schema")
        self.assertTrue(request_payload["text"]["format"]["strict"])
        self.assertEqual(result["schemaVersion"], 2)
        self.assertEqual(result["title"]["evidenceIds"], ["jira:DEMO-1"])

    def test_uses_shared_openai_model_unless_work_brief_override_is_configured(self) -> None:
        output = model_output()
        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "test-openai-key",
                "OPENAI_MODEL": "shared-deployment-model",
            },
            clear=True,
        ):
            with patch(
                "work_brief.service.requests.post",
                return_value=valid_model_response(output),
            ) as post:
                generate_work_brief(self.request("safe evidence"))

        self.assertEqual(
            post.call_args.kwargs["json"]["model"],
            "shared-deployment-model",
        )

        with patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "test-openai-key",
                "OPENAI_MODEL": "shared-deployment-model",
                "WORK_BRIEF_OPENAI_MODEL": "work-brief-override",
            },
            clear=True,
        ):
            with patch(
                "work_brief.service.requests.post",
                return_value=valid_model_response(output),
            ) as post:
                generate_work_brief(self.request("safe evidence"))

        self.assertEqual(
            post.call_args.kwargs["json"]["model"],
            "work-brief-override",
        )

    def test_secret_fixtures_never_reach_openai_or_database_paths(self) -> None:
        fixtures = (
            "sk-proj-abcdefghijklmnopqrstuvwxyz",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature",
            "-----BEGIN PRIVATE KEY-----",
            "postgresql://db-user:db-password@db.example/internal",
            "OPENAI_API_KEY=synthetic-secret",
            "fixture/.env",
        )
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
            with patch("work_brief.service.requests.post") as post:
                for fixture in fixtures:
                    with self.subTest(fixture=fixture):
                        with self.assertRaises(WorkBriefError):
                            generate_work_brief(self.request(fixture))

        post.assert_not_called()

    def test_rescans_model_output_and_keeps_placeholder_consistency(self) -> None:
        output = model_output(title=citation("user@example.com에 공유"))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
            with patch("work_brief.service.requests.post", return_value=valid_model_response(output)):
                result = generate_work_brief(self.request("user@example.com의 요구사항"))

        self.assertEqual(result["title"]["text"], "[EMAIL_1]에 공유")

    def test_rescans_every_text_field_of_schema_v2_including_new_ones(self) -> None:
        """Guards R8: a v2 field that skips the DLP re-scan leaks raw PII."""
        planted = {
            "title": "010-1111-2222",
            "summary": "010-2222-3333",
            "keyPoints": "010-3333-4444",
            "acceptanceCriteria": "010-4444-5555",
            "risks": "010-5555-6666",
            "nextSteps": "010-6666-7777",
            "childTaskSummary": "010-7777-8888",
            "childTaskText": "010-8888-9999",
            "excludedReason": "010-9999-0000",
        }
        output = model_output(
            title=citation(planted["title"]),
            summary=citation(planted["summary"]),
            keyPoints=[citation(planted["keyPoints"])],
            acceptanceCriteria=[citation(planted["acceptanceCriteria"])],
            risks=[citation(planted["risks"])],
            nextSteps=[citation(planted["nextSteps"])],
            childTasks=[
                {
                    "summary": planted["childTaskSummary"],
                    "text": planted["childTaskText"],
                    "evidenceIds": ["jira:DEMO-1"],
                },
            ],
            excludedEvidence=[
                {"evidenceId": "jira:DEMO-2", "reason": planted["excludedReason"]},
            ],
        )
        request = WorkBriefGenerateRequest(
            instruction="아래 근거로 실행 브리프를 만드세요.",
            evidence=[
                {"evidenceId": "jira:DEMO-1", "content": "안전한 근거"},
                {"evidenceId": "jira:DEMO-2", "content": "관련 없는 근거"},
            ],
        )
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
            with patch("work_brief.service.requests.post", return_value=valid_model_response(output)):
                result = generate_work_brief(request)

        serialized = json.dumps(result, ensure_ascii=False)
        for raw_value in planted.values():
            self.assertNotIn(raw_value, serialized)
        self.assertTrue(
            any("[PHONE_" in text for text in all_strings(result)),
            "expected masked placeholders in the model output",
        )

    def test_rejects_a_v1_response_after_the_schema_v2_rollout(self) -> None:
        legacy_output = {
            "title": "배포 준비",
            "summary": "완료",
            "keyPoints": ["검증 완료"],
            "risks": ["없음"],
            "nextSteps": ["공유"],
            "evidenceIds": ["jira:DEMO-1"],
        }
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
            with patch(
                "work_brief.service.requests.post",
                return_value=valid_model_response(legacy_output),
            ):
                with self.assertRaises(WorkBriefError):
                    generate_work_brief(self.request("safe evidence"))

    def test_rejects_items_without_their_own_evidence(self) -> None:
        invalid_outputs = {
            "empty item citation": model_output(
                acceptanceCriteria=[{"text": "검증 결과가 기록된다", "evidenceIds": []}],
            ),
            "unrequested item citation": model_output(
                risks=[citation("일정 확인", ["confluence:unrequested"])],
            ),
            "duplicate item citation": model_output(
                nextSteps=[citation("공유", ["jira:DEMO-1", "jira:DEMO-1"])],
            ),
            "blank item text": model_output(keyPoints=[citation("   ")]),
            "wrong schema version": model_output(schemaVersion=1),
        }
        for label, output in invalid_outputs.items():
            with self.subTest(label):
                with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
                    with patch(
                        "work_brief.service.requests.post",
                        return_value=valid_model_response(output),
                    ):
                        with self.assertRaises(WorkBriefError):
                            generate_work_brief(self.request("safe evidence"))

    def test_rejects_evidence_that_is_both_cited_and_excluded(self) -> None:
        output = model_output(
            excludedEvidence=[
                {"evidenceId": "jira:DEMO-1", "reason": "본문이 요구사항과 무관합니다"},
            ],
        )
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
            with patch("work_brief.service.requests.post", return_value=valid_model_response(output)):
                with self.assertRaises(WorkBriefError):
                    generate_work_brief(self.request("safe evidence"))

    def test_rejects_unaccounted_evidence_and_copied_full_citation_sets(self) -> None:
        request = WorkBriefGenerateRequest(
            instruction="아래 근거로 실행 브리프를 만드세요.",
            evidence=[
                {"evidenceId": "jira:DEMO-1", "content": "요구사항 A"},
                {"evidenceId": "jira:DEMO-2", "content": "요구사항 B"},
            ],
        )
        all_evidence = ["jira:DEMO-1", "jira:DEMO-2"]
        invalid_outputs = {
            "unaccounted evidence": model_output(),
            "copied full citation sets": model_output(
                title=citation("배포 준비", all_evidence),
                summary=citation("완료", all_evidence),
                keyPoints=[citation("검증 완료", all_evidence)],
                acceptanceCriteria=[citation("검증 결과가 기록된다", all_evidence)],
                risks=[citation("일정 확인", all_evidence)],
                nextSteps=[citation("테스트 실행", all_evidence)],
                childTasks=[
                    {
                        "summary": "검증 기록 추가",
                        "text": "검증 결과를 이슈에 남긴다",
                        "evidenceIds": all_evidence,
                    },
                ],
            ),
        }
        for label, output in invalid_outputs.items():
            with self.subTest(label=label):
                with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
                    with patch(
                        "work_brief.service.requests.post",
                        return_value=valid_model_response(output),
                    ):
                        with self.assertRaises(WorkBriefError):
                            generate_work_brief(request)

    def test_rejects_requirements_without_linked_acceptance_and_child_task(self) -> None:
        request = WorkBriefGenerateRequest(
            instruction="아래 근거로 실행 브리프를 만드세요.",
            evidence=[
                {"evidenceId": "jira:DEMO-1", "content": "요구사항 A"},
                {"evidenceId": "jira:DEMO-2", "content": "요구사항 B"},
            ],
        )
        invalid_outputs = {
            "second requirement is uncovered": model_output(
                keyPoints=[
                    citation("요구사항 A", ["jira:DEMO-1"]),
                    citation("요구사항 B", ["jira:DEMO-2"]),
                ],
                acceptanceCriteria=[citation("A 검증", ["jira:DEMO-1"])],
                childTasks=[
                    {
                        "summary": "A 작업",
                        "text": "A를 수행한다",
                        "evidenceIds": ["jira:DEMO-1"],
                    },
                ],
            ),
            "empty acceptance criteria": model_output(acceptanceCriteria=[]),
            "empty child tasks": model_output(childTasks=[]),
        }
        for label, output in invalid_outputs.items():
            with self.subTest(label=label):
                with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
                    with patch(
                        "work_brief.service.requests.post",
                        return_value=valid_model_response(output),
                    ):
                        with self.assertRaises(WorkBriefError):
                            generate_work_brief(request)

    def test_keeps_per_item_citations_instead_of_one_shared_evidence_list(self) -> None:
        output = model_output(
            title=citation("배포 준비", ["jira:DEMO-1"]),
            keyPoints=[citation("검증 완료", ["jira:DEMO-2"])],
            acceptanceCriteria=[citation("검증 결과가 기록된다", ["jira:DEMO-2"])],
            childTasks=[
                {
                    "summary": "검증 기록 추가",
                    "text": "검증 결과를 이슈에 남긴다",
                    "evidenceIds": ["jira:DEMO-2"],
                },
            ],
        )
        request = WorkBriefGenerateRequest(
            instruction="아래 근거로 실행 브리프를 만드세요.",
            evidence=[
                {"evidenceId": "jira:DEMO-1", "content": "이슈 설명"},
                {"evidenceId": "jira:DEMO-2", "content": "검증 요구사항"},
            ],
        )
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
            with patch("work_brief.service.requests.post", return_value=valid_model_response(output)):
                result = generate_work_brief(request)

        self.assertEqual(result["title"]["evidenceIds"], ["jira:DEMO-1"])
        self.assertEqual(result["keyPoints"][0]["evidenceIds"], ["jira:DEMO-2"])
        self.assertNotEqual(
            result["title"]["evidenceIds"],
            result["keyPoints"][0]["evidenceIds"],
        )

    def test_sanitizes_user_edited_text_without_an_openai_request(self) -> None:
        with patch("work_brief.service.requests.post") as post:
            result = sanitize_work_brief_values(WorkBriefSanitizeRequest(
                values=["담당자 user@example.com", "010-1234-5678로 연락"],
            ))

        self.assertEqual(result["values"], ["담당자 [EMAIL_1]", "[PHONE_1]로 연락"])
        post.assert_not_called()

    def test_rejects_unverified_model_evidence_ids(self) -> None:
        output = model_output(title=citation("배포 준비", ["confluence:unrequested"]))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
            with patch("work_brief.service.requests.post", return_value=valid_model_response(output)):
                with self.assertRaises(WorkBriefError):
                    generate_work_brief(self.request("safe evidence"))

    def test_work_brief_service_does_not_depend_on_wiki_rag_or_vector_storage(self) -> None:
        source = Path(__file__).parents[1].joinpath("work_brief", "service.py").read_text()

        self.assertNotIn("wiki_documents", source)
        self.assertNotIn("wiki_document_chunks", source)
        self.assertNotIn("/documents", source)
        self.assertNotIn("make_embedding", source)

    def test_validation_error_never_echoes_pre_dlp_evidence(self) -> None:
        raw_evidence = "user@example.com " + "x" * 8_100
        with patch.dict(os.environ, {"AI_SERVICE_API_KEY": "service-key"}, clear=False):
            response = TestClient(app).post(
                "/work-brief/generate",
                headers={"X-AI-Service-Key": "service-key"},
                json={
                    "instruction": "create a brief",
                    "evidence": [{"evidenceId": "jira:DEMO-1", "content": raw_evidence}],
                },
            )

        self.assertEqual(response.status_code, 422)
        self.assertNotIn("user@example.com", response.text)
        self.assertNotIn(raw_evidence, response.text)


if __name__ == "__main__":
    unittest.main()
