// Browser calls to the LangSmith API, authenticated as the signed-in user (verified CORS-safe in Phase 0).
export const LANGSMITH_API_URL = "https://api.smith.langchain.com";
export const LANGSMITH_APP_URL = "https://smith.langchain.com";

export const FEEDBACK_KEY = "user_score";

export interface FeedbackInput {
  readonly runId: string;
  readonly score: 0 | 1;
  readonly comment?: string;
}

interface Deps {
  /** Adds the user's credential; see apiFetch. */
  readonly fetchFn: typeof fetch;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`LangSmith returned ${response.status}`);
  return (await response.json()) as T;
}

/** Creates the feedback row, or updates it when the user changes their vote or adds a comment. */
export async function saveFeedback(
  { fetchFn }: Deps,
  input: FeedbackInput,
  existingId?: string,
): Promise<string> {
  const body = { score: input.score, comment: input.comment ?? null };
  const response = existingId
    ? await fetchFn(`${LANGSMITH_API_URL}/api/v1/feedback/${existingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    : await fetchFn(`${LANGSMITH_API_URL}/api/v1/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, run_id: input.runId, key: FEEDBACK_KEY }),
      });
  const saved = await json<{ id: string }>(response);
  return saved.id ?? existingId;
}

export async function findProjectId(
  { fetchFn }: Deps,
  projectName: string,
): Promise<string | null> {
  const response = await fetchFn(
    `${LANGSMITH_API_URL}/api/v1/sessions?name=${encodeURIComponent(projectName)}`,
  );
  const projects = await json<Array<{ id: string }>>(response);
  return projects[0]?.id ?? null;
}

export function traceUrl(workspaceId: string, projectId: string, runId: string): string {
  return `${LANGSMITH_APP_URL}/o/${workspaceId}/projects/p/${projectId}/r/${runId}?trace_id=${runId}`;
}
