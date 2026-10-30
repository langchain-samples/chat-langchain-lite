import { describe, expect, it } from "vitest";

import examples from "../dataset/examples.json" with { type: "json" };
import { planUpsert, toExampleBody, type SeedExample } from "../src/dataset.ts";

const seeds = examples as SeedExample[];
const seed = seeds[0]!;

describe("seed file", () => {
  it("has 42 uniquely-identified examples with 2-4 assertions each and an 8-example demo split", () => {
    expect(seeds).toHaveLength(42);
    expect(new Set(seeds.map((example) => example.id)).size).toBe(42);
    expect(
      seeds.every((example) => example.assertions.length >= 2 && example.assertions.length <= 4),
    ).toBe(true);
    expect(seeds.filter((example) => example.demo)).toHaveLength(8);
  });
});

describe("toExampleBody", () => {
  it("keeps the seed id in metadata and adds the demo split when flagged", () => {
    const body = toExampleBody({ ...seed, demo: true });
    expect(body.metadata.example_id).toBe(seed.id);
    expect(body.split).toEqual([seed.split, "demo"]);
    expect(body.outputs).toEqual({ assertions: seed.assertions });
  });
});

describe("planUpsert", () => {
  const body = toExampleBody(seed);
  const existing = {
    id: "ex-1",
    inputs: body.inputs,
    outputs: body.outputs,
    metadata: { ...body.metadata, dataset_split: body.split, source_run_id: "kept" },
  };

  it("creates missing seeds and leaves current ones alone", () => {
    expect(planUpsert([seed], [])).toMatchObject({ create: [body], update: [], unchanged: 0 });
    expect(planUpsert([seed], [existing])).toMatchObject({ create: [], update: [], unchanged: 1 });
  });

  it("updates a seed whose assertions changed", () => {
    const edited = { ...seed, assertions: [{ key: "must_x", comment: "Says x." }] };
    expect(planUpsert([edited], [existing]).update).toEqual([
      { id: "ex-1", body: toExampleBody(edited) },
    ]);
  });

  it("never touches examples that didn't come from the seed, such as triage additions", () => {
    const feedback = {
      id: "ex-2",
      inputs: {},
      outputs: {},
      metadata: { source: "production_feedback" },
    };
    const plan = planUpsert([seed], [existing, feedback]);
    expect(plan.update).toEqual([]);
    expect(plan.create).toEqual([]);
  });
});
