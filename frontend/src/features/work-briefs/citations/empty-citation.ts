import type { EvidenceCitation } from "../work-briefs.types";

export const emptyCitation = (evidenceIds: string[]): EvidenceCitation => ({
  text: "새 항목",
  evidenceIds,
  userAuthored: true,
});
