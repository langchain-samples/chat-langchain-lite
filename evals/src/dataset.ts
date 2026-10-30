import { isDeepStrictEqual } from "node:util";

import type { Api } from "./api.ts";

export const DATASET_NAME = "chat-langchain-lite";
export const BASELINE_TAG = "demo-baseline";

// The `$ref` must be relative: the backend registers the message schema under this id, and the
// absolute https URL fails as unresolvable.
export const INPUTS_SCHEMA = {
  type: "object",
  required: ["messages"],
  properties: {
    messages: {
      type: "array",
      minItems: 1,
      items: { $ref: "/public/schemas/v1/message.json" },
    },
  },
};

export const OUTPUTS_SCHEMA = {
  type: "object",
  required: ["assertions"],
  properties: {
    assertions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["key", "comment"],
        properties: { key: { type: "string" }, comment: { type: "string" } },
      },
    },
  },
};

export const TRANSFORMATIONS = [
  { path: ["inputs", "messages"], transformation_type: "convert_to_openai_message" },
  { path: ["inputs", "messages"], transformation_type: "remove_system_messages" },
  { path: ["inputs"], transformation_type: "remove_extra_fields" },
  { path: ["outputs"], transformation_type: "remove_extra_fields" },
];

export interface SeedExample {
  readonly id: string;
  readonly split: string;
  readonly demo: boolean;
  readonly messages: readonly { role: string; content: string }[];
  readonly assertions: readonly { key: string; comment: string }[];
  readonly metadata: Record<string, unknown>;
}

export interface ExampleBody {
  readonly inputs: { messages: SeedExample["messages"] };
  readonly outputs: { assertions: SeedExample["assertions"] };
  readonly metadata: Record<string, unknown>;
  readonly split: readonly string[];
}

export interface ExistingExample {
  readonly id: string;
  readonly inputs: unknown;
  readonly outputs: unknown;
  readonly metadata: Record<string, unknown> | null;
}

export function toExampleBody(seed: SeedExample): ExampleBody {
  return {
    inputs: { messages: seed.messages },
    outputs: { assertions: seed.assertions },
    metadata: { ...seed.metadata, example_id: seed.id },
    split: seed.demo ? [seed.split, "demo"] : [seed.split],
  };
}

export interface UpsertPlan {
  readonly create: readonly ExampleBody[];
  readonly update: readonly { readonly id: string; readonly body: ExampleBody }[];
  readonly unchanged: number;
}

/** Matches seeds to existing examples by `metadata.example_id`; never deletes anything. */
export function planUpsert(
  seeds: readonly SeedExample[],
  existing: readonly ExistingExample[],
): UpsertPlan {
  const byExampleId = new Map(
    existing
      .filter((example) => typeof example.metadata?.example_id === "string")
      .map((example) => [example.metadata!.example_id as string, example]),
  );
  const create: ExampleBody[] = [];
  const update: { id: string; body: ExampleBody }[] = [];
  let unchanged = 0;
  for (const seed of seeds) {
    const body = toExampleBody(seed);
    const current = byExampleId.get(seed.id);
    if (!current) {
      create.push(body);
    } else if (isSeedCurrent(current, body)) {
      unchanged += 1;
    } else {
      update.push({ id: current.id, body });
    }
  }
  return { create, update, unchanged };
}

function isSeedCurrent(current: ExistingExample, body: ExampleBody): boolean {
  const metadata = current.metadata ?? {};
  const splits = [metadata.dataset_split].flat().filter(Boolean).sort();
  return (
    isDeepStrictEqual(current.inputs, body.inputs) &&
    isDeepStrictEqual(current.outputs, body.outputs) &&
    Object.entries(body.metadata).every(([key, value]) =>
      isDeepStrictEqual(metadata[key], value),
    ) &&
    isDeepStrictEqual(splits, [...body.split].sort())
  );
}

interface DatasetRecord {
  readonly id: string;
  readonly name: string;
}

export interface SeededDataset {
  readonly id: string;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  /** Version timestamp `demo-baseline` points to after seeding. */
  readonly baselineAsOf: string;
}

export async function seedDataset(api: Api, seeds: readonly SeedExample[]): Promise<SeededDataset> {
  const dataset = await ensureDataset(api);
  const existing = await listExamples(api, dataset.id);
  const plan = planUpsert(seeds, existing);

  if (plan.create.length > 0) {
    await api.post(
      "/examples/bulk",
      plan.create.map((body) => ({ ...body, dataset_id: dataset.id })),
    );
  }
  for (const { id, body } of plan.update) {
    await api.patch(`/examples/${id}`, { ...body, dataset_id: dataset.id });
  }

  const changed = plan.create.length + plan.update.length > 0;
  const tagged = await resolveBaseline(api, dataset.id);
  const baselineAsOf = changed || !tagged ? await tagLatestVersion(api, dataset.id) : tagged;
  return {
    id: dataset.id,
    created: plan.create.length,
    updated: plan.update.length,
    unchanged: plan.unchanged,
    baselineAsOf,
  };
}

async function ensureDataset(api: Api): Promise<DatasetRecord> {
  const [found] = await api.get<DatasetRecord[]>("/datasets", { name: DATASET_NAME });
  if (found) return found;
  return api.post<DatasetRecord>("/datasets", {
    name: DATASET_NAME,
    description:
      "Docs Q&A test cases for chat-langchain-lite. Inputs are chat messages; reference outputs are assertions a correct answer must satisfy.",
    data_type: "kv",
    inputs_schema_definition: INPUTS_SCHEMA,
    outputs_schema_definition: OUTPUTS_SCHEMA,
    transformations: TRANSFORMATIONS,
  });
}

export async function listExamples(
  api: Api,
  datasetId: string,
  asOf?: string,
  split?: string,
): Promise<ExistingExample[]> {
  const pageSize = 100;
  const examples: ExistingExample[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await api.get<ExistingExample[]>("/examples", {
      dataset: datasetId,
      limit: pageSize,
      offset,
      as_of: asOf,
      splits: split,
    });
    examples.push(...page);
    if (page.length < pageSize) return examples;
  }
}

async function tagLatestVersion(api: Api, datasetId: string): Promise<string> {
  const [latest] = await api.get<{ as_of: string }[]>(`/datasets/${datasetId}/versions`, {
    limit: 1,
  });
  if (!latest) throw new Error(`Dataset ${datasetId} has no versions to tag`);
  await api.put(`/datasets/${datasetId}/tags`, { as_of: latest.as_of, tag: BASELINE_TAG });
  return latest.as_of;
}

/** Resolves the moving `demo-baseline` tag to the immutable version timestamp it points to. */
export async function resolveBaseline(api: Api, datasetId: string): Promise<string | undefined> {
  try {
    const version = await api.get<{ as_of: string }>(`/datasets/${datasetId}/version`, {
      tag: BASELINE_TAG,
    });
    return version.as_of;
  } catch {
    return undefined;
  }
}
