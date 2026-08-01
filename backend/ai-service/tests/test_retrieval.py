import unittest
from unittest.mock import patch

from main import AccessContext, chunk_document_text, reciprocal_rank_fusion, search_documents_from_database, should_abstain


class RetrievalTests(unittest.TestCase):
    def test_chunking_preserves_overlapping_context(self) -> None:
        chunks = chunk_document_text("one two three four five", chunk_size=3, overlap=1)

        self.assertEqual(chunks, ["one two three", "three four five"])

    def test_reciprocal_rank_fusion_rewards_documents_found_by_both_retrievers(self) -> None:
        ranked = reciprocal_rank_fusion(["wiki-a", "wiki-b"], ["wiki-b", "wiki-c"])

        self.assertEqual(ranked[0], "wiki-b")

    def test_abstention_requires_evidence_above_the_configured_threshold(self) -> None:
        self.assertTrue(should_abstain([], 0.2))
        self.assertTrue(should_abstain([{"confidence": 0.19}], 0.2))
        self.assertFalse(should_abstain([{"confidence": 0.2}], 0.2))

    def test_hybrid_mode_falls_back_to_the_document_vector_baseline_before_chunk_backfill(self) -> None:
        expected = [{"sourceId": "wiki-1"}]
        with patch("main.search_documents_from_database_hybrid", side_effect=RuntimeError("chunk table missing")):
            with patch("main.search_documents_from_database_baseline", return_value=expected):
                with patch.dict("os.environ", {"RAG_RETRIEVAL_MODE": "hybrid-chunks"}):
                    documents = search_documents_from_database(
                        "휴가 규정",
                        None,
                        AccessContext(role="employee", department="엔지니어링"),
                    )

        self.assertEqual(documents, expected)


if __name__ == "__main__":
    unittest.main()
