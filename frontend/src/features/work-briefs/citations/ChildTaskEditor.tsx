import { Button, Checkbox, TextInput } from "../../../design-system/components";
import type { ChildTask, WorkEvidence } from "../work-briefs.types";
import { citationAnchorId } from "./citation-anchors";
import { CitationEditor } from "./CitationEditor";
import { emptyCitation } from "./empty-citation";

export function ChildTaskEditor({
  items,
  evidence,
  emptyNotice,
  onChange,
}: {
  items: ChildTask[];
  evidence: WorkEvidence[];
  emptyNotice?: string | null;
  onChange: (items: ChildTask[]) => void;
}) {
  const defaultEvidenceIds = evidence
    .filter((item) => item.aiStatus !== "excluded")
    .map((item) => item.id);

  function addTask() {
    const clientTaskId = window.crypto.randomUUID();
    onChange([
      ...items,
      {
        ...emptyCitation(defaultEvidenceIds),
        clientTaskId,
        summary: "새 하위 작업",
        selected: true,
      },
    ]);
  }

  return (
    <section className="work-brief-list-editor ds-card">
      <div className="work-brief-section-heading">
        <h3>하위 작업</h3>
        <Button type="button" variant="secondary" size="sm" onClick={addTask}>
          하위 작업 추가
        </Button>
      </div>
      {items.length === 0 && emptyNotice ? (
        <p className="work-brief-section-empty">{emptyNotice}</p>
      ) : null}
      {items.map((item, index) => (
        <div className="work-brief-child-task ds-card" key={item.clientTaskId}>
          <Checkbox
            checked={item.selected}
            onChange={(event) =>
              onChange(
                items.map((current, currentIndex) =>
                  currentIndex === index
                    ? { ...current, selected: event.target.checked }
                    : current,
                ),
              )
            }
            label="게시 후보에 선택"
          />
          <label>
            작업 제목
            <TextInput
              value={item.summary}
              onChange={(event) =>
                onChange(
                  items.map((current, currentIndex) =>
                    currentIndex === index
                      ? {
                          ...current,
                          summary: event.target.value,
                          userAuthored: true,
                        }
                      : current,
                  ),
                )
              }
            />
          </label>
          <CitationEditor
            label="작업 근거"
            anchorId={citationAnchorId("하위 작업", index + 1)}
            citation={item}
            evidence={evidence}
            onChange={(next) =>
              onChange(
                items.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, ...next } : current,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="work-brief-remove-button"
            onClick={() =>
              onChange(
                items.filter((_, currentIndex) => currentIndex !== index),
              )
            }
          >
            삭제
          </Button>
        </div>
      ))}
    </section>
  );
}
