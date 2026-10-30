import { ASSISTANT_ID, findAgent } from "./agent.ts";
import { ApiError, type Api } from "./api.ts";
import { DATASET_NAME } from "./dataset.ts";
import { QUEUE_NAME } from "./triage.ts";

const ENVIRONMENTS = ["local", "development", "staging", "production"] as const;
const DEPLOYED_ENVIRONMENTS = ["development", "production"] as const;
// The CLI deploys this demo used to run named Context Hub repos after the agent; GitHub builds name them after the deployment.
const LEGACY_CONTEXT_HUB_REPOS = [ASSISTANT_ID, `${ASSISTANT_ID}-development`];
// Deleting a GitHub-sourced deployment also deletes its Context Hub repo when the build tagged it this way.
const GITHUB_SOURCED_HUB_TAG = "managed-deepagents:github";
// LangSmith names what it creates for an evaluator after the rule's parent: "Evaluator: <dataset or project>:<rule> …".
const EVALUATOR_RESOURCE_PREFIX = `Evaluator: ${ASSISTANT_ID}`;
const EVAL_PROMPT_PREFIX = `eval_${ASSISTANT_ID.replaceAll("-", "_")}_`;
const FEEDBACK_KEY = "answer_ok";

export interface Removal {
  readonly api: "smith" | "host";
  readonly path: string;
  readonly query?: Record<string, string | boolean>;
}

/** One resource. It has a removal, or names what removes it, or neither (it can't be removed through the API). */
export interface Item {
  readonly id: string;
  readonly name: string;
  readonly detail?: string;
  readonly removal?: Removal;
  readonly removedWith?: string;
}

export interface Inventory {
  readonly agent: readonly Item[];
  readonly deployments: readonly Item[];
  readonly contextHubRepos: readonly Item[];
  readonly projects: readonly Item[];
  readonly datasets: readonly Item[];
  readonly referenceDatasets: readonly Item[];
  readonly experiments: readonly Item[];
  readonly evaluators: readonly Item[];
  readonly rules: readonly Item[];
  readonly prompts: readonly Item[];
  readonly queues: readonly Item[];
  readonly feedbackConfigs: readonly Item[];
}

export type Section = keyof Inventory;

const TITLES: Record<Section, string> = {
  agent: "Agent",
  deployments: "Deployments",
  contextHubRepos: "Context Hub repos",
  projects: "Tracing projects",
  datasets: "Dataset",
  referenceDatasets: "Evaluator reference datasets",
  experiments: "Experiments",
  evaluators: "Evaluators",
  rules: "Rules (automations)",
  prompts: "Evaluator prompts",
  queues: "Annotation queues",
  feedbackConfigs: "Feedback configs",
};

const DISPLAY_ORDER: readonly Section[] = [
  "agent",
  "deployments",
  "contextHubRepos",
  "projects",
  "datasets",
  "experiments",
  "evaluators",
  "rules",
  "prompts",
  "referenceDatasets",
  "queues",
  "feedbackConfigs",
];

// Nothing cascades downward, so dependents go first. A prompt deleted before its evaluator strands the evaluator where
// the API can no longer delete it; a dataset deleted before its rules orphans them.
export const DELETION_ORDER: readonly Section[] = [
  "rules",
  "evaluators",
  "prompts",
  "referenceDatasets",
  "queues",
  "datasets",
  "feedbackConfigs",
  "contextHubRepos",
  "deployments",
  "agent",
  "projects",
];

export const KNOWN_LEFTOVERS = [
  "Each reference dataset's hidden Alignment evaluator. The API hides system evaluators, so only LangSmith can remove them; nothing shows or runs them once their rule is gone.",
  "Tagging and dataset version-tag rows. They have no delete route and nothing shows them once their resources are gone.",
];

export interface PlannedRemoval {
  readonly section: Section;
  readonly item: Item;
  readonly removal: Removal;
}

export function deletionPlan(inventory: Inventory): PlannedRemoval[] {
  return DELETION_ORDER.flatMap((section) =>
    inventory[section].flatMap((item) =>
      item.removal ? [{ section, item, removal: item.removal }] : [],
    ),
  );
}

export function isEmpty(inventory: Inventory): boolean {
  return deletionPlan(inventory).length === 0;
}

export function renderInventory(inventory: Inventory): string {
  const lines: string[] = [];
  for (const section of DISPLAY_ORDER) {
    const items = inventory[section];
    if (items.length === 0) continue;
    lines.push(`\n${TITLES[section]} (${items.length})`);
    for (const item of items) {
      const how = item.removal
        ? ""
        : item.removedWith
          ? ` [removed with ${item.removedWith}]`
          : " [can't be removed through the API]";
      lines.push(`  - ${item.name}${item.id === item.name ? "" : `  ${item.id}`}${how}`);
      if (item.detail) lines.push(`      ${item.detail}`);
    }
  }
  return lines.join("\n");
}

interface RuleRecord {
  readonly id: string;
  readonly display_name: string;
  readonly session_name?: string | null;
  readonly dataset_name?: string | null;
  readonly evaluator_id?: string | null;
  readonly is_enabled: boolean;
  readonly group_by?: string | null;
  readonly add_to_annotation_queue_id?: string | null;
}

interface EvaluatorRecord {
  readonly id: string;
  readonly name: string;
  readonly llm_evaluator?: {
    readonly prompt_id: string;
    readonly prompt_repo_handle?: string;
    readonly annotation_queue_id?: string | null;
    readonly corrections_dataset_id?: string | null;
  } | null;
  readonly code_evaluator?: object | null;
}

interface Named {
  readonly id: string;
  readonly name: string;
}

async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function ruleTarget(rule: RuleRecord): string {
  return rule.session_name ?? rule.dataset_name ?? "nothing";
}

function attachments(rules: readonly RuleRecord[], evaluatorId: string): string {
  const targets = rules
    .filter((rule) => rule.evaluator_id === evaluatorId)
    .map((rule) => `${ruleTarget(rule)}${rule.is_enabled ? "" : " (off)"}`);
  return targets.length > 0 ? `attached to ${targets.join(", ")}` : "not attached";
}

/** Reads every resource chat-langchain-lite created in the workspace. Read-only. */
export async function discoverInventory(api: Api, hostApi: Api): Promise<Inventory> {
  const agent = await findAgent(api);

  const deployments: Item[] = [];
  // Context Hub repo handle (= deployment name) → its environment; null for the legacy CLI-named repos.
  const hubOwners = new Map<string, string | null>(LEGACY_CONTEXT_HUB_REPOS.map((h) => [h, null]));
  for (const environment of DEPLOYED_ENVIRONMENTS) {
    const response = await hostApi.get<{
      resources?: { id: string; name: string; is_preview?: boolean }[];
    }>("/v2/deployments", { agent_id: ASSISTANT_ID, agent_environment: environment });
    for (const record of response.resources ?? []) {
      if (!record.is_preview) hubOwners.set(record.name, environment);
      deployments.push(
        record.is_preview
          ? { id: record.id, name: record.name, removedWith: `the ${environment} deployment` }
          : {
              id: record.id,
              name: record.name,
              detail: `${environment}; its threads, secrets${environment === "development" ? ", previews" : ""} and build go with it`,
              removal: {
                api: "host",
                path: `/v2/deployments/${record.id}`,
                query: { delete_tracing_project: false },
              },
            },
      );
    }
  }

  const contextHubRepos: Item[] = [];
  for (const [handle, environment] of hubOwners) {
    const found = await orNull(
      api.get<{ repo: { id: string; repo_type: string; tags?: string[] } }>(`/repos/-/${handle}`),
    );
    if (found?.repo.repo_type !== "agent") continue;
    if (environment !== null) {
      // MDA leaves a same-name repo it didn't create alone, and so does this.
      if (found.repo.tags?.includes(GITHUB_SOURCED_HUB_TAG))
        contextHubRepos.push({
          id: found.repo.id,
          name: handle,
          detail: "instructions.md and skills synced from git on each build",
          removedWith: `the ${environment} deployment`,
        });
      continue;
    }
    contextHubRepos.push({
      id: found.repo.id,
      name: handle,
      detail: "from the old mda CLI deploys; nothing syncs it now",
      // The plain repo delete leaves the directory's file repos behind.
      removal: {
        api: "smith",
        path: `/platform/hub/repos/-/${handle}/directories`,
        query: { repo_type: "agent" },
      },
    });
  }

  const projectsById = new Map<string, Item>();
  for (const environment of ENVIRONMENTS) {
    const name = `${ASSISTANT_ID}-${environment}`;
    const [session] = await api.get<Named[]>("/sessions", { name, reference_free: true });
    if (session?.name === name)
      projectsById.set(session.id, {
        id: session.id,
        name,
        detail: "its traces, feedback and rules go with it",
        removal: { api: "smith", path: `/sessions/${session.id}` },
      });
  }
  const projects = [...projectsById.values()];

  const agentItems: Item[] = agent
    ? [
        {
          id: ASSISTANT_ID,
          name: ASSISTANT_ID,
          detail: `${agent.environments?.length ?? 0} environments and the Agent tag (with its taggings) go with it`,
          removal: { api: "smith", path: `/agents/${ASSISTANT_ID}` },
        },
      ]
    : [];

  const [mainDataset] = (await api.get<Named[]>("/datasets", { name: DATASET_NAME })).filter(
    (dataset) => dataset.name === DATASET_NAME,
  );
  const prefixed = (
    await api.get<Named[]>("/datasets", { name_contains: EVALUATOR_RESOURCE_PREFIX, limit: 100 })
  ).filter((dataset) => dataset.name.startsWith(EVALUATOR_RESOURCE_PREFIX));

  const rules: RuleRecord[] = [];
  for (const project of projects)
    rules.push(...(await api.get<RuleRecord[]>("/runs/rules", { session_id: project.id })));
  for (const dataset of [mainDataset, ...prefixed].filter(Boolean))
    rules.push(...(await api.get<RuleRecord[]>("/runs/rules", { dataset_id: dataset!.id })));

  const evaluatorIds = new Set(
    rules.flatMap((rule) => (rule.evaluator_id ? [rule.evaluator_id] : [])),
  );
  const listed = await api.get<{ evaluators: { id: string }[] }>("/platform/evaluators", {
    agent_id: ASSISTANT_ID,
    limit: 100,
  });
  for (const evaluator of listed.evaluators) evaluatorIds.add(evaluator.id);
  const evaluatorRecords: EvaluatorRecord[] = [];
  for (const id of evaluatorIds) {
    // System Alignment evaluators come back 404: they're hidden from the public API.
    const record = await orNull(api.get<EvaluatorRecord>(`/platform/evaluators/${id}`));
    if (record) evaluatorRecords.push(record);
  }
  const visibleEvaluators = new Set(evaluatorRecords.map((record) => record.id));

  const referenceOwners = new Map(
    evaluatorRecords.flatMap((record) =>
      record.llm_evaluator?.corrections_dataset_id
        ? [[record.llm_evaluator.corrections_dataset_id, record.name]]
        : [],
    ),
  );
  const referenceDatasets = prefixed;

  const evaluators: Item[] = evaluatorRecords.map((record) => ({
    id: record.id,
    name: record.name,
    detail: `${record.llm_evaluator ? "LLM" : "code"}; ${attachments(rules, record.id)}`,
    removal: {
      api: "smith",
      path: `/platform/evaluators/${record.id}`,
      query: { delete_run_rules: false },
    },
  }));

  const ruleItems: Item[] = rules.map((rule) => {
    const hidden = rule.evaluator_id && !visibleEvaluators.has(rule.evaluator_id);
    const kind = rule.add_to_annotation_queue_id
      ? "adds runs to a queue"
      : hidden
        ? "system Alignment rule; its evaluator is hidden"
        : rule.group_by === "trajectory_id"
          ? "trajectory"
          : "evaluator";
    return {
      id: rule.id,
      name: rule.display_name,
      detail: `on ${ruleTarget(rule)}, ${rule.is_enabled ? "on" : "off"}, ${kind}`,
      removal: { api: "smith", path: `/runs/rules/${rule.id}` },
    };
  });

  const promptHandles = new Map<string, string>();
  for (const record of evaluatorRecords) {
    const llm = record.llm_evaluator;
    if (llm?.prompt_repo_handle)
      promptHandles.set(llm.prompt_repo_handle, `prompt of ${record.name}`);
  }
  const promptSearch = await api.get<{ repos: { repo_handle: string; repo_type: string }[] }>(
    "/repos/",
    {
      query: EVAL_PROMPT_PREFIX,
      repo_type: "prompt",
      limit: 100,
    },
  );
  for (const repo of promptSearch.repos)
    if (repo.repo_handle.startsWith(EVAL_PROMPT_PREFIX) && !promptHandles.has(repo.repo_handle))
      promptHandles.set(repo.repo_handle, "an evaluator prompt whose evaluator is gone");
  const prompts: Item[] = [...promptHandles].map(([handle, detail]) => ({
    id: handle,
    name: handle,
    detail,
    removal: { api: "smith", path: `/repos/-/${handle}` },
  }));

  const alignmentQueues = new Map(
    evaluatorRecords.flatMap((record) =>
      record.llm_evaluator?.annotation_queue_id
        ? [[record.llm_evaluator.annotation_queue_id, record.name]]
        : [],
    ),
  );
  const queues: Item[] = (await api.get<Named[]>("/annotation-queues", { limit: 100 }))
    .filter(
      (queue) => queue.name === QUEUE_NAME || queue.name.startsWith(EVALUATOR_RESOURCE_PREFIX),
    )
    .map((queue) => {
      const owner = alignmentQueues.get(queue.id);
      // A queue an evaluator still points at can't be deleted directly; its evaluator's delete removes it.
      return owner
        ? {
            id: queue.id,
            name: queue.name,
            detail: "alignment queue",
            removedWith: `evaluator ${owner}`,
          }
        : {
            id: queue.id,
            name: queue.name,
            detail:
              queue.name === QUEUE_NAME
                ? "thumbs-down triage"
                : "alignment queue whose evaluator is gone",
            removal: { api: "smith", path: `/annotation-queues/${queue.id}` },
          };
    });

  const experiments: Item[] = [];
  for (const dataset of [mainDataset, ...referenceDatasets].filter(Boolean))
    for (const session of await api.get<Named[]>("/sessions", {
      reference_dataset: dataset!.id,
      limit: 100,
    }))
      experiments.push({
        id: session.id,
        name: session.name,
        removedWith: `dataset ${dataset!.name}`,
      });

  const feedbackConfigs: Item[] = (
    await api.get<{ id: string; feedback_key: string }[]>("/feedback-configs", {
      key: FEEDBACK_KEY,
    })
  )
    .filter((config) => config.feedback_key === FEEDBACK_KEY)
    .map((config) => ({
      id: config.id,
      name: config.feedback_key,
      detail: "the triage queue's rubric",
      removal: { api: "smith", path: "/feedback-configs/", query: { feedback_key: FEEDBACK_KEY } },
    }));

  const datasetItem = (dataset: Named, detail: string): Item => ({
    id: dataset.id,
    name: dataset.name,
    detail,
    removal: { api: "smith", path: `/datasets/${dataset.id}` },
  });

  return {
    agent: agentItems,
    deployments,
    contextHubRepos,
    projects,
    datasets: mainDataset
      ? [datasetItem(mainDataset, "seed examples and the demo-baseline version")]
      : [],
    referenceDatasets: referenceDatasets.map((dataset) =>
      datasetItem(
        dataset,
        referenceOwners.has(dataset.id)
          ? `reference dataset of ${referenceOwners.get(dataset.id)}`
          : "reference dataset whose evaluator is gone",
      ),
    ),
    experiments,
    evaluators,
    rules: ruleItems,
    prompts,
    queues,
    feedbackConfigs,
  };
}
