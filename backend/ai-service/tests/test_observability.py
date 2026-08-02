import unittest

from main import estimate_chat_cost, extract_token_usage


class ObservabilityTests(unittest.TestCase):
    def test_extracts_langchain_usage_metadata(self) -> None:
        usage = extract_token_usage({"input_tokens": 120, "output_tokens": 30})

        self.assertEqual(usage, {"inputTokens": 120, "outputTokens": 30})

    def test_calculates_cost_from_input_and_output_token_counts(self) -> None:
        cost = estimate_chat_cost({"inputTokens": 1_000_000, "outputTokens": 1_000_000})

        self.assertGreater(cost, 0)


if __name__ == "__main__":
    unittest.main()
