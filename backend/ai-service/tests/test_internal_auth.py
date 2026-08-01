import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from main import require_internal_api_key


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


if __name__ == "__main__":
    unittest.main()
