import argparse
import json
import os
import statistics
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from main import AccessContext, ChatRequest, chat, is_document_visible


@dataclass
class EvaluationCase:
    case_id: str
    question: str
    access: AccessContext
    expected_source_ids: list[str]
    answerable: bool


def load_cases(path: Path) -> list[EvaluationCase]:
    cases: list[EvaluationCase] = []

    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        raw = json.loads(line)
        cases.append(EvaluationCase(
            case_id=str(raw["caseId"]),
            question=str(raw["question"]),
            access=AccessContext(**raw["access"]),
            expected_source_ids=[str(value) for value in raw.get("expectedSourceIds", [])],
            answerable=bool(raw["answerable"]),
        ))

    if len(cases) != 30:
        raise ValueError(f"Golden Set must contain exactly 30 cases, found {len(cases)}.")

    for case in cases:
        if case.answerable and not case.expected_source_ids:
            raise ValueError(f"{case.case_id} must define at least one expected source ID.")
        if any(source_id.startswith("REPLACE_WITH_") for source_id in case.expected_source_ids):
            raise ValueError(f"{case.case_id} still contains a template source ID.")

    return cases


def score_results(results: list[dict[str, Any]]) -> dict[str, float | int]:
    answerable = [result for result in results if result["answerable"]]
    retrieved = [result for result in answerable if result["expectedSourceIds"]]
    hit_count = sum(any(source in result["sourceIds"] for source in result["expectedSourceIds"]) for result in retrieved)
    reciprocal_ranks: list[float] = []
    citation_total = 0
    citation_correct = 0

    for result in retrieved:
        for index, source_id in enumerate(result["sourceIds"], start=1):
            citation_total += 1
            if source_id in result["expectedSourceIds"]:
                citation_correct += 1
                reciprocal_ranks.append(1 / index)
                break
        else:
            reciprocal_ranks.append(0.0)

    abstention_correct = sum(result["abstained"] == (not result["answerable"]) for result in results)
    auth_leaks = sum(result["authorizationLeak"] for result in results)
    latencies = sorted(result["latencyMs"] for result in results)

    return {
        "cases": len(results),
        "hitAt5": round(hit_count / len(retrieved), 4) if retrieved else 0.0,
        "mrr": round(sum(reciprocal_ranks) / len(retrieved), 4) if retrieved else 0.0,
        "citationAccuracy": round(citation_correct / citation_total, 4) if citation_total else 0.0,
        "abstentionAccuracy": round(abstention_correct / len(results), 4) if results else 0.0,
        "authorizationLeaks": auth_leaks,
        "p50LatencyMs": percentile(latencies, 0.5),
        "p95LatencyMs": percentile(latencies, 0.95),
        "averageInputTokens": round(statistics.mean(result["inputTokens"] for result in results), 2) if results else 0.0,
        "averageOutputTokens": round(statistics.mean(result["outputTokens"] for result in results), 2) if results else 0.0,
        "averageCost": round(statistics.mean(result["estimatedCost"] for result in results), 8) if results else 0.0,
    }


def percentile(values: list[int], ratio: float) -> int:
    if not values:
        return 0
    index = min(len(values) - 1, max(0, round((len(values) - 1) * ratio)))
    return values[index]


def run_mode(cases: list[EvaluationCase], mode: str) -> dict[str, Any]:
    previous_mode = os.getenv("RAG_RETRIEVAL_MODE")
    os.environ["RAG_RETRIEVAL_MODE"] = mode
    results: list[dict[str, Any]] = []

    try:
        for case in cases:
            started_at = datetime.now(UTC)
            response = chat(ChatRequest(question=case.question, access=case.access))
            latency_ms = int((datetime.now(UTC) - started_at).total_seconds() * 1000)
            sources = response.get("sources", [])
            results.append({
                "caseId": case.case_id,
                "answerable": case.answerable,
                "expectedSourceIds": case.expected_source_ids,
                "sourceIds": [source["sourceId"] for source in sources],
                "abstained": bool(response.get("abstained", False)),
                "authorizationLeak": any(not is_document_visible(case.access, source["department"]) for source in sources),
                "latencyMs": latency_ms,
                "inputTokens": int(response.get("inputTokens", 0)),
                "outputTokens": int(response.get("outputTokens", 0)),
                "estimatedCost": float(response.get("estimatedCost", 0.0)),
            })
    finally:
        if previous_mode is None:
            os.environ.pop("RAG_RETRIEVAL_MODE", None)
        else:
            os.environ["RAG_RETRIEVAL_MODE"] = previous_mode

    return {"mode": mode, "metrics": score_results(results), "results": results}


def write_report(report: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    json_path = output_dir / f"rag-eval-{timestamp}.json"
    markdown_path = output_dir / f"rag-eval-{timestamp}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# RAG Evaluation Report", "", f"Measured at: {report['measuredAt']}", ""]
    for run in report["runs"]:
        metrics = run["metrics"]
        lines.extend([
            f"## {run['mode']}", "",
            f"- Hit@5: {metrics['hitAt5']}",
            f"- MRR: {metrics['mrr']}",
            f"- Citation accuracy: {metrics['citationAccuracy']}",
            f"- Abstention accuracy: {metrics['abstentionAccuracy']}",
            f"- Authorization leaks: {metrics['authorizationLeaks']}",
            f"- p50 / p95 latency: {metrics['p50LatencyMs']} / {metrics['p95LatencyMs']} ms",
            f"- Average input / output tokens: {metrics['averageInputTokens']} / {metrics['averageOutputTokens']}",
            f"- Average cost per query: {metrics['averageCost']}",
            "",
        ])
    markdown_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, markdown_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run repeatable RAG evaluations against a fixed Golden Set.")
    parser.add_argument("--cases", type=Path, required=True, help="30-case JSONL Golden Set with real source IDs.")
    parser.add_argument("--output-dir", type=Path, default=Path("evals/reports"))
    parser.add_argument("--modes", choices=["both", "document-vector", "hybrid-chunks"], default="both")
    args = parser.parse_args()

    cases = load_cases(args.cases)
    modes = ["document-vector", "hybrid-chunks"] if args.modes == "both" else [args.modes]
    report = {
        "measuredAt": datetime.now(UTC).isoformat(),
        "openAiModel": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "embeddingModel": os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
        "runs": [run_mode(cases, mode) for mode in modes],
    }
    json_path, markdown_path = write_report(report, args.output_dir)
    print(f"json_report={json_path}")
    print(f"markdown_report={markdown_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
