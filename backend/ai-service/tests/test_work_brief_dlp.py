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
        output = {
            "title": "배포 준비",
            "summary": "[EMAIL_1]과 검토합니다.",
            "keyPoints": ["검증 완료"],
            "risks": ["일정 확인"],
            "nextSteps": ["테스트 실행"],
            "evidenceIds": ["jira:DEMO-1"],
        }
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
        self.assertEqual(result["evidenceIds"], ["jira:DEMO-1"])

    def test_uses_shared_openai_model_unless_work_brief_override_is_configured(self) -> None:
        output = {
            "title": "배포 준비",
            "summary": "완료",
            "keyPoints": ["검증 완료"],
            "risks": ["없음"],
            "nextSteps": ["공유"],
            "evidenceIds": ["jira:DEMO-1"],
        }
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
        output = {
            "title": "user@example.com에 공유",
            "summary": "완료",
            "keyPoints": ["검증 완료"],
            "risks": ["없음"],
            "nextSteps": ["공유"],
            "evidenceIds": ["jira:DEMO-1"],
        }
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-openai-key"}, clear=False):
            with patch("work_brief.service.requests.post", return_value=valid_model_response(output)):
                result = generate_work_brief(self.request("user@example.com의 요구사항"))

        self.assertEqual(result["title"], "[EMAIL_1]에 공유")

    def test_sanitizes_user_edited_text_without_an_openai_request(self) -> None:
        with patch("work_brief.service.requests.post") as post:
            result = sanitize_work_brief_values(WorkBriefSanitizeRequest(
                values=["담당자 user@example.com", "010-1234-5678로 연락"],
            ))

        self.assertEqual(result["values"], ["담당자 [EMAIL_1]", "[PHONE_1]로 연락"])
        post.assert_not_called()

    def test_rejects_unverified_model_evidence_ids(self) -> None:
        output = {
            "title": "배포 준비",
            "summary": "완료",
            "keyPoints": ["검증 완료"],
            "risks": ["없음"],
            "nextSteps": ["공유"],
            "evidenceIds": ["confluence:unrequested"],
        }
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
