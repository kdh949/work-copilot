import unittest

from evals.run import score_results


class EvaluationMetricsTests(unittest.TestCase):
    def test_scores_retrieval_citations_abstention_and_authorization(self) -> None:
        metrics = score_results([
            {
                "answerable": True,
                "expectedSourceIds": ["wiki-1"],
                "sourceIds": ["wiki-1"],
                "abstained": False,
                "authorizationLeak": False,
                "latencyMs": 10,
                "inputTokens": 100,
                "outputTokens": 10,
                "estimatedCost": 0.0001,
            },
            {
                "answerable": False,
                "expectedSourceIds": [],
                "sourceIds": [],
                "abstained": True,
                "authorizationLeak": False,
                "latencyMs": 20,
                "inputTokens": 0,
                "outputTokens": 0,
                "estimatedCost": 0.0,
            },
        ])

        self.assertEqual(metrics["hitAt5"], 1.0)
        self.assertEqual(metrics["mrr"], 1.0)
        self.assertEqual(metrics["citationAccuracy"], 1.0)
        self.assertEqual(metrics["abstentionAccuracy"], 1.0)
        self.assertEqual(metrics["authorizationLeaks"], 0)


if __name__ == "__main__":
    unittest.main()
