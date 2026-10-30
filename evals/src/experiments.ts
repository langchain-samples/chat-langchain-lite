import { ASSISTANT_ID, type Deployment, type Environment } from "./agent.ts";
import type { Api } from "./api.ts";
import { listExamples } from "./dataset.ts";
import { mapPool } from "./pool.ts";

export interface ExperimentSpec {
  readonly role: string;
  readonly environment: Environment;
  readonly repetitions: number;
  readonly model?: string;
}

export const EXPERIMENTS: readonly ExperimentSpec[] = [
  { role: "production-baseline", environment: "production", repetitions: 3 },
  { role: "development-candidate", environment: "development", repetitions: 3 },
  {
    role: "development-gpt-6-luna",
    environment: "development",
    repetitions: 2,
    model: "gpt-6-luna",
  },
];

export const OFFLINE_KEYS = [
  "assertions_passed",
  "professional_tone",
  "searched_docs",
  "cites_retrieved_docs",
] as const;

/** Identity: role + deployed revision + the dataset version the tag resolved to (+ split, if any). */
export function experimentName(
  spec: ExperimentSpec,
  revisionId: string,
  asOf: string,
  split?: string,
): string {
  const version = asOf.slice(0, 19).replace(/[^0-9T]/g, "");
  const name = `${spec.role}::rev-${revisionId.slice(0, 8)}::data-${version}`;
  return split ? `${name}::split-${split}` : name;
}

/** The base name, plus an optional retry tag and the 8-hex suffix studio_experiment appends. */
export function isSameExperiment(sessionName: string, baseName: string): boolean {
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(::retry-\\d+)?(::[0-9a-f]{8})?$`).test(sessionName);
}

interface SessionStats {
  readonly id: string;
  readonly name: string;
  readonly run_count: number | null;
  readonly feedback_stats: Record<string, { n?: number }> | null;
}

export interface Completion {
  readonly rows: number;
  readonly expectedRows: number;
  readonly missingScores: Record<string, number>;
  readonly complete: boolean;
}

export function completionOf(
  stats: SessionStats,
  expectedRows: number,
  keys: readonly string[],
): Completion {
  const rows = stats.run_count ?? 0;
  const missingScores = Object.fromEntries(
    keys
      .map(
        (key) => [key, Math.max(0, expectedRows - (stats.feedback_stats?.[key]?.n ?? 0))] as const,
      )
      .filter(([, missing]) => missing > 0),
  );
  return {
    rows,
    expectedRows,
    missingScores,
    complete: rows >= expectedRows && Object.keys(missingScores).length === 0,
  };
}

async function sessionStats(api: Api, sessionId: string): Promise<SessionStats> {
  return api.get<SessionStats>(`/sessions/${sessionId}`, { include_stats: true });
}

export interface ExperimentResult {
  readonly role: string;
  readonly name: string;
  readonly sessionId: string;
  readonly expectedRows: number;
  readonly status: "skipped-complete" | "ran";
  readonly failedRuns: number;
}

export async function runExperiment(options: {
  readonly api: Api;
  readonly agentApi: Api;
  readonly spec: ExperimentSpec;
  readonly deployment: Deployment;
  readonly datasetId: string;
  readonly asOf: string;
  readonly concurrency: number;
  readonly split?: string;
  /** Run again even when a complete experiment exists for this revision and dataset version. */
  readonly fresh?: boolean;
  readonly log: (line: string) => void;
}): Promise<ExperimentResult> {
  const { api, agentApi, spec, deployment, datasetId, asOf, concurrency, split, log } = options;
  const examples = await listExamples(api, datasetId, asOf, split);
  if (examples.length === 0)
    throw new Error(`No examples in ${split ? `split ${split}` : "the dataset"} at ${asOf}`);
  const expectedRows = examples.length * spec.repetitions;
  const baseName = experimentName(spec, deployment.revisionId, asOf, split);

  // The studio_experiment endpoint appends a random suffix to the name, so match on the prefix.
  const existing = await api.get<SessionStats[]>("/sessions", {
    name_contains: baseName,
    reference_dataset: datasetId,
  });
  const match = existing.find((session) => isSameExperiment(session.name, baseName));
  if (match && !options.fresh) {
    const completion = completionOf(await sessionStats(api, match.id), expectedRows, OFFLINE_KEYS);
    if (completion.complete) {
      log(`${spec.role}: already complete (${baseName})`);
      return {
        role: spec.role,
        name: baseName,
        sessionId: match.id,
        expectedRows,
        status: "skipped-complete",
        failedRuns: 0,
      };
    }
    log(
      `${spec.role}: ${baseName} is partial (${completion.rows}/${expectedRows} rows); re-running under a new name`,
    );
  }

  const name = match ? `${baseName}::retry-${Date.now()}` : baseName;
  const session = await api.post<{ id: string; name: string }>("/datasets/studio_experiment", {
    project_name: name,
    dataset_id: datasetId,
    metadata: {
      role: spec.role,
      environment: spec.environment,
      revision_id: deployment.revisionId,
      dataset_version: asOf,
      split: split ?? "all",
      model: spec.model ?? "claude-haiku-5-5",
    },
  });

  const jobs = Array.from({ length: spec.repetitions }, () => examples).flat();
  let done = 0;
  const failures = await mapPool(jobs, concurrency, async (example) => {
    try {
      // Same shape as Studio's "Run experiment": the server writes a linked copy of the run into the
      // experiment, and the thread's ls_experiment_id keeps online evaluators off it.
      const thread = await agentApi.post<{ thread_id: string }>("/threads", {
        metadata: { ls_experiment_id: session.id },
      });
      const run = await agentApi.post<{ run_id: string }>(`/threads/${thread.thread_id}/runs`, {
        assistant_id: ASSISTANT_ID,
        input: example.inputs,
        context: spec.model ? { eval_model: spec.model } : undefined,
        langsmith_tracer: { project_name: session.name, example_id: example.id },
      });
      await agentApi.get(`/threads/${thread.thread_id}/runs/${run.run_id}/join`);
      return 0;
    } catch {
      return 1;
    } finally {
      done += 1;
      if (done % 20 === 0 || done === jobs.length) log(`${spec.role}: ${done}/${jobs.length} runs`);
    }
  });

  return {
    role: spec.role,
    name: session.name,
    sessionId: session.id,
    expectedRows,
    status: "ran",
    failedRuns: failures.filter(Boolean).length,
  };
}

/** Earlier experiments prepare ran for this role, which a refresh replaces. Experiments people ran keep other names. */
export function staleExperiments<T extends { readonly name: string }>(
  sessions: readonly T[],
  role: string,
  keepName: string,
): T[] {
  return sessions.filter(
    (session) => session.name.startsWith(`${role}::rev-`) && session.name !== keepName,
  );
}

export async function removeStaleExperiments(
  api: Api,
  datasetId: string,
  experiment: ExperimentResult,
): Promise<number> {
  const sessions = await api.get<{ id: string; name: string }[]>("/sessions", {
    name_contains: `${experiment.role}::rev-`,
    reference_dataset: datasetId,
  });
  const stale = staleExperiments(sessions, experiment.role, experiment.name);
  for (const session of stale) await api.delete(`/sessions/${session.id}`);
  return stale.length;
}

export async function waitForScores(options: {
  readonly api: Api;
  readonly experiments: readonly ExperimentResult[];
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly log: (line: string) => void;
}): Promise<Record<string, Completion>> {
  const { api, experiments, timeoutMs, pollMs, sleep, now, log } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    const entries = await Promise.all(
      experiments.map(async (experiment) => {
        const stats = await sessionStats(api, experiment.sessionId);
        return [
          experiment.role,
          completionOf(stats, experiment.expectedRows, OFFLINE_KEYS),
        ] as const;
      }),
    );
    const completions = Object.fromEntries(entries);
    if (entries.every(([, completion]) => completion.complete) || now() >= deadline) {
      for (const [role, completion] of entries) {
        if (!completion.complete) {
          log(
            `${role}: incomplete after the wait: ${completion.rows}/${completion.expectedRows} rows, missing ${JSON.stringify(completion.missingScores)}`,
          );
        }
      }
      return completions;
    }
    await sleep(pollMs);
  }
}
