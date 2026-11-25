import { describe, expect, it } from "vitest";

import seedsJson from "../dataset/ambiguity-corrections.json" with { type: "json" };
import {
  type CorrectionSeed,
  missingCorrections,
  seedCorrections,
  toCorrectionBody,
} from "../src/corrections.ts";
import { AMBIGUITY_RULE_NAME, ambiguityRule } from "../src/evaluators.ts";
import { fakeApi } from "./fake-api.ts";

const seeds = seedsJson as CorrectionSeed[];
const judge = { id: "cfg-1", model: {} };
const seed = seeds[0]!;

describe("ambiguity seeds", () => {
  it("has 3-5 uniquely-identified, text-only seeds that both pass and fail", () => {
    expect(seeds.length).toBeGreaterThanOrEqual(3);
    expect(seeds.length).toBeLessThanOrEqual(5);
    expect(new Set(seeds.map((entry) => entry.id)).size).toBe(seeds.length);
    expect(new Set(seeds.map((entry) => entry.passes))).toEqual(new Set([true, false]));
    expect(seeds.some((entry) => entry.answer.includes("```"))).toBe(false);
  });

  it("keys inputs by the rule's prompt variables", () => {
    const mapping = (ambiguityRule("s-1", judge) as any).evaluators[0].structured.variable_mapping;
    expect(Object.keys(toCorrectionBody(seed, AMBIGUITY_RULE_NAME).inputs).sort()).toEqual(
      Object.keys(mapping).sort(),
    );
  });
});

describe("toCorrectionBody", () => {
  it("stores the score as the UI does, with the explanation the few-shot section renders", () => {
    expect(toCorrectionBody({ ...seed, passes: true }, "k").outputs).toEqual({
      k: "1",
      few_shot_explanation: seed.explanation,
    });
    expect(toCorrectionBody({ ...seed, passes: false }, "k").outputs.k).toBe("0");
    expect(toCorrectionBody(seed, "k").metadata).toEqual({ seed_id: seed.id });
  });
});

describe("missingCorrections", () => {
  it("skips seeds already present and ignores corrections made in the UI", () => {
    const existing = [
      { id: "e-1", inputs: {}, outputs: {}, metadata: { seed_id: seeds[1]!.id } },
      { id: "e-2", inputs: {}, outputs: {}, metadata: null },
    ];
    const missing = missingCorrections(seeds.slice(0, 2), existing, "k");
    expect(missing.map((body) => body.metadata.seed_id)).toEqual([seed.id]);
  });
});

describe("seedCorrections", () => {
  it("posts only the missing seeds to the corrections dataset", async () => {
    const api = fakeApi((call) =>
      call.method === "GET"
        ? [{ id: "e-1", inputs: {}, outputs: {}, metadata: { seed_id: seed.id } }]
        : undefined,
    );
    await expect(seedCorrections(api, "cd-1", seeds.slice(0, 2), "k")).resolves.toEqual({
      created: 1,
      unchanged: 1,
    });
    const post = api.calls.find((call) => call.method === "POST");
    expect(post?.path).toBe("/examples/bulk");
    expect(post?.body).toEqual([{ ...toCorrectionBody(seeds[1]!, "k"), dataset_id: "cd-1" }]);
  });

  it("writes nothing when every seed is present", async () => {
    const api = fakeApi(() =>
      seeds.map((entry, index) => ({
        id: `e-${index}`,
        inputs: {},
        outputs: {},
        metadata: { seed_id: entry.id },
      })),
    );
    await seedCorrections(api, "cd-1", seeds, "k");
    expect(api.calls.every((call) => call.method === "GET")).toBe(true);
  });
});
