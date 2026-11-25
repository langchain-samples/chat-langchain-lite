import type { Api } from "./api.ts";
import { listExamples, type ExistingExample } from "./dataset.ts";

export interface CorrectionSeed {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly passes: boolean;
  readonly explanation: string;
}

export interface CorrectionBody {
  readonly inputs: { readonly question: string; readonly answer: string };
  readonly outputs: Readonly<Record<string, string>>;
  readonly metadata: { readonly seed_id: string };
}

/**
 * Inputs are keyed by prompt variable: without `ls_correction_version` the backend uses them as-is.
 * Scores are "1"/"0" like UI corrections, because the hidden Alignment evaluator runs int() on them.
 */
export function toCorrectionBody(seed: CorrectionSeed, scoreKey: string): CorrectionBody {
  return {
    inputs: { question: seed.question, answer: seed.answer },
    outputs: { [scoreKey]: seed.passes ? "1" : "0", few_shot_explanation: seed.explanation },
    metadata: { seed_id: seed.id },
  };
}

/** Seeds not yet in the dataset, matched by `metadata.seed_id`. */
export function missingCorrections(
  seeds: readonly CorrectionSeed[],
  existing: readonly ExistingExample[],
  scoreKey: string,
): CorrectionBody[] {
  const present = new Set(existing.map((example) => example.metadata?.seed_id));
  return seeds
    .filter((seed) => !present.has(seed.id))
    .map((seed) => toCorrectionBody(seed, scoreKey));
}

/** Adds missing seeds and never edits or deletes, so corrections made in the UI survive a re-run. */
export async function seedCorrections(
  api: Api,
  datasetId: string,
  seeds: readonly CorrectionSeed[],
  scoreKey: string,
): Promise<{ readonly created: number; readonly unchanged: number }> {
  const create = missingCorrections(seeds, await listExamples(api, datasetId), scoreKey);
  if (create.length > 0) {
    await api.post(
      "/examples/bulk",
      create.map((body) => ({ ...body, dataset_id: datasetId })),
    );
  }
  return { created: create.length, unchanged: seeds.length - create.length };
}
