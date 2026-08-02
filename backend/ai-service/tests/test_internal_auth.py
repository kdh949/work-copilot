import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from fastapi.testclient import TestClient

from main import AccessContext, app, fallback_documents, is_document_visible, require_internal_api_key, search_documents


class InternalApiKeyTests(unittest.TestCase):
    def test_accepts_the_configured_internal_service_key(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_API_KEY": "service-key"}):
            require_internal_api_key("service-key")

    def test_rejects_missing_or_incorrect_internal_service_key(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_API_KEY": "service-key"}):
            with self.assertRaises(HTTPException) as missing_error:
                require_internal_api_key(None)

            self.assertEqual(missing_error.exception.status_code, 401)

            with self.assertRaises(HTTPException) as incorrect_error:
                require_internal_api_key("wrong-key")

            self.assertEqual(incorrect_error.exception.status_code, 401)

    def test_rejects_requests_when_the_service_key_is_not_configured(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_API_KEY": ""}):
            with self.assertRaises(HTTPException) as error:
                require_internal_api_key("anything")

        self.assertEqual(error.exception.status_code, 503)

    def test_chat_endpoint_rejects_direct_requests_without_the_internal_key(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_API_KEY": "service-key"}):
            response = TestClient(app).post("/chat", json={
                "question": "휴가 규정",
                "access": {"role": "employee", "department": "엔지니어링"},
            })

        self.assertEqual(response.status_code, 401)


class RetrievalAccessTests(unittest.TestCase):
    def test_employee_can_only_retrieve_common_or_own_department_documents(self) -> None:
        actor = AccessContext(role="employee", department="엔지니어링")

        self.assertTrue(is_document_visible(actor, "공통"))
        self.assertTrue(is_document_visible(actor, "엔지니어링"))
        self.assertFalse(is_document_visible(actor, "인사"))

    def test_administrator_can_retrieve_every_department_document(self) -> None:
        actor = AccessContext(role="admin", department="인사")

        self.assertTrue(is_document_visible(actor, "엔지니어링"))

    def test_memory_retrieval_excludes_another_department_document(self) -> None:
        fallback_documents.clear()
        fallback_documents.extend([
            {"sourceId": "common", "title": "공통", "content": "휴가 규정", "department": "공통", "tags": []},
            {"sourceId": "engineering", "title": "엔지니어링", "content": "휴가 규정", "department": "엔지니어링", "tags": []},
            {"sourceId": "hr", "title": "인사", "content": "휴가 규정", "department": "인사", "tags": []},
        ])

        with patch.dict(os.environ, {"DATABASE_URL": ""}):
            documents = search_documents("휴가 규정", None, AccessContext(role="employee", department="엔지니어링"))

        self.assertEqual([document["sourceId"] for document in documents], ["common", "engineering"])
        fallback_documents.clear()


if __name__ == "__main__":
    unittest.main()
