import { withConnectionStatusRefresh } from "./work-brief-guards.ts";
import type {
  ConfluenceSpaceList,
  WorkBriefApiRequest,
} from "./work-briefs.types";

/**
 * Space names can trigger a bounded set of provider metadata reads. Do not
 * start that work for the draft editor, or until the optional source controls
 * are actually visible.
 */
export function shouldLoadConfluenceSpaces(
  draftId: string | undefined,
  showSourceOptions: boolean,
  alreadyRequested: boolean,
): boolean {
  return !draftId && showSourceOptions && !alreadyRequested;
}

export function loadConfluenceSpaces(
  request: WorkBriefApiRequest,
  refreshConnections: () => Promise<void>,
): Promise<ConfluenceSpaceList> {
  return withConnectionStatusRefresh(
    () => request<ConfluenceSpaceList>("/work-items/confluence/spaces"),
    refreshConnections,
  );
}
