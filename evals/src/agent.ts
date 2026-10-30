import { ApiError, createApi, type Api } from "./api.ts";
import type { Config } from "./config.ts";

export const ASSISTANT_ID = "chat-langchain-lite";
// Mirrors the agent's output limit, so simulated users can spot answers that ran out of room.
export const AGENT_OUTPUT_LIMIT = 900;
export type Environment = "production" | "development";

/** The agent only accepts OAuth tokens directly; a LangSmith API key needs the platform's scheme, as Studio and Engine send. */
export const PLATFORM_SCHEME = { "x-auth-scheme": "langsmith" } as const;

export function agentApi(config: Config, deployment: { readonly url: string }): Api {
  return createApi({
    baseUrl: deployment.url,
    apiKey: config.apiKey,
    workspaceId: config.workspaceId,
    headers: PLATFORM_SCHEME,
  });
}

export interface AgentRecord {
  readonly tag_value_id: string | null;
  readonly environments?: readonly { readonly tracer_session_id: string }[];
}

/** Null when the workspace has no Agent for this id (not deployed, or agent views not enabled yet). */
export async function findAgent(api: Api): Promise<AgentRecord | null> {
  try {
    return await api.get<AgentRecord>(`/agents/${ASSISTANT_ID}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export interface Deployment {
  readonly environment: Environment;
  readonly url: string;
  readonly revisionId: string;
  readonly tracerSessionId: string;
}

interface DeploymentRecord {
  readonly id: string;
  readonly active_revision_id: string | null;
  readonly latest_revision_id: string | null;
  readonly tracer_session_id: string | null;
  readonly url?: string | null;
  readonly is_preview?: boolean;
  readonly source_config: { readonly custom_url: string | null };
}

export async function findDeployment(hostApi: Api, environment: Environment): Promise<Deployment> {
  const response = await hostApi.get<{ resources?: DeploymentRecord[] } | DeploymentRecord[]>(
    "/v2/deployments",
    { agent_id: ASSISTANT_ID, agent_environment: environment },
  );
  // Preview deployments share the development environment.
  const record = (Array.isArray(response) ? response : (response.resources ?? [])).find(
    (candidate) => !candidate.is_preview,
  );
  const url = record?.url ?? record?.source_config.custom_url;
  const revisionId = record?.active_revision_id ?? record?.latest_revision_id;
  if (!record || !url || !revisionId || !record.tracer_session_id) {
    throw new Error(
      `No deployed ${environment} environment for agent ${ASSISTANT_ID}. Run mise run demo:install first.`,
    );
  }
  return { environment, url, revisionId, tracerSessionId: record.tracer_session_id };
}

export interface AgentMessage {
  readonly type?: string;
  readonly content?: unknown;
  readonly usage_metadata?: { readonly output_tokens?: number };
}

export interface Answer {
  readonly text: string;
  readonly outputTokens: number;
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block === "string" ? block : ((block as { text?: string }).text ?? "")))
    .join("");
}

export function finalAnswer(messages: readonly AgentMessage[]): Answer {
  const last = [...messages].reverse().find((message) => message.type === "ai");
  return {
    text: contentText(last?.content),
    outputTokens: last?.usage_metadata?.output_tokens ?? 0,
  };
}

// The streamed state drops stop_reason/finish_reason, so a reply that used the whole output
// budget is the only sign it ended early.
export function usedWholeBudget(answer: Answer, outputLimit: number): boolean {
  return answer.outputTokens >= outputLimit;
}

export function looksInformal(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}

export interface AskOptions {
  readonly context?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  /** Continue this conversation instead of starting one. */
  readonly threadId?: string;
}

export interface AskResult {
  readonly runId: string;
  readonly threadId: string;
  readonly answer: Answer;
}

/** One question, on a fresh thread unless `threadId` is given, waiting for the final state. */
export async function ask(
  agentApi: Api,
  question: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const thread = options.threadId
    ? { thread_id: options.threadId }
    : await agentApi.post<{ thread_id: string }>("/threads", { metadata: options.metadata ?? {} });
  const run = await agentApi.post<{ run_id: string }>(`/threads/${thread.thread_id}/runs`, {
    assistant_id: ASSISTANT_ID,
    input: { messages: [{ role: "user", content: question }] },
    context: options.context,
    metadata: options.metadata,
  });
  const state = await agentApi.get<{ messages?: AgentMessage[] }>(
    `/threads/${thread.thread_id}/runs/${run.run_id}/join`,
  );
  return {
    runId: run.run_id,
    threadId: thread.thread_id,
    answer: finalAnswer(state.messages ?? []),
  };
}
