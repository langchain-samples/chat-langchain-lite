import { describe, expect, it } from "vitest";

import {
  ANSWER_PATH,
  ASSERTIONS_RULE_NAME,
  assertionsRule,
  ensureRule,
  ONLINE_FILTER,
  sharedRule,
  sharedTrajectoryRule,
  TONE_LLM_RULE_NAME,
  toneLlmRule,
  toneRule,
  trajectoryRule,
} from "../src/evaluators.ts";
import { fakeApi } from "./fake-api.ts";

const judge = { id: "cfg-1", model: { lc: 1, type: "constructor", id: ["x"], kwargs: {} } };

describe("rule bodies", () => {
  it("names the Assertions rule so queue adds don't create a duplicate, and reads the final answer", () => {
    const rule = assertionsRule("ds-1", judge) as any;
    expect(rule.display_name).toBe(ASSERTIONS_RULE_NAME);
    expect(rule.evaluators[0].structured.variable_mapping.outputs).toBe(ANSWER_PATH);
    expect(rule.evaluators[0].structured.model).toBe(judge.model);
  });

  it("passes the Jev key as a secret reference, not a string", () => {
    const kwargs = (toneRule("ds-1") as any).evaluators[0].structured.model.kwargs;
    expect(kwargs.typesafe_api_key).toEqual({ lc: 1, type: "secret", id: ["LC_GATEWAY_KEY"] });
  });
});

describe("toneLlmRule", () => {
  const rule = toneLlmRule("ds-1") as any;
  const structured = rule.evaluators[0].structured;

  it("asks for an alignment queue, which needs exactly one boolean key", () => {
    expect(rule.create_alignment_queue).toBe(true);
    const booleans = Object.entries(structured.schema.properties).filter(
      ([, property]: [string, any]) => property.type === "boolean",
    );
    expect(booleans.map(([key]) => key)).toEqual([TONE_LLM_RULE_NAME]);
  });

  it("runs luna through the Gateway with the key as a secret reference", () => {
    expect(structured.model.kwargs.model).toBe("gpt-6-luna");
    expect(structured.model.kwargs.openai_api_key).toEqual({
      lc: 1,
      type: "secret",
      id: ["LC_GATEWAY_KEY"],
    });
    expect(structured.variable_mapping).toEqual({ answer: ANSWER_PATH });
  });
});

describe("trajectoryRule", () => {
  it("groups by trajectory and maps the trajectory variable the way the backend requires", () => {
    const rule = trajectoryRule("s-1", judge) as any;
    expect(rule.group_by).toBe("trajectory_id");
    expect(rule.evaluators[0].structured.variable_mapping).toEqual({ trajectory: "trajectory" });
    expect(rule.evaluators[0].structured.prompt[0][1]).toContain("{{trajectory}}");
  });
});

describe("ensureRule", () => {
  const target = { kind: "dataset", datasetId: "ds-1" } as const;

  it("creates a rule when none with that name exists", async () => {
    const api = fakeApi((call) =>
      call.method === "GET" ? [] : { id: "r-new", evaluator_id: "ev-new" },
    );
    await expect(ensureRule(api, target, { display_name: "x" })).resolves.toEqual({
      name: "x",
      id: "r-new",
      evaluatorId: "ev-new",
      status: "created",
    });
  });

  it("leaves an existing rule alone so UI alignment and few-shot settings survive", async () => {
    const api = fakeApi(() => [{ id: "r-1", display_name: "x", evaluator_id: "ev-1" }]);
    await expect(ensureRule(api, target, { display_name: "x" })).resolves.toEqual({
      name: "x",
      id: "r-1",
      evaluatorId: "ev-1",
      status: "exists",
    });
    expect(api.calls.some((call) => call.method !== "GET")).toBe(false);
  });
});

describe("sharedRule", () => {
  const source = {
    name: "professional_tone",
    id: "r-1",
    evaluatorId: "ev-1",
    status: "exists",
  } as const;

  it("attaches the existing evaluator by id instead of defining a new one", () => {
    const rule = sharedRule({ kind: "session", sessionId: "s-1" }, source) as any;
    expect(rule).toMatchObject({
      display_name: "professional_tone",
      session_id: "s-1",
      filter: ONLINE_FILTER,
      evaluator_id: "ev-1",
    });
    expect(rule.evaluators).toBeUndefined();
    expect(rule.code_evaluators).toBeUndefined();
  });

  it("filters experiment copies out of trace rules only", () => {
    expect(
      (sharedRule({ kind: "dataset", datasetId: "ds-1" }, source) as any).filter,
    ).toBeUndefined();
  });

  it("can attach the evaluator turned off", () => {
    const target = { kind: "session", sessionId: "s-1" } as const;
    expect((sharedRule(target, source) as any).is_enabled).toBe(true);
    expect((sharedRule(target, source, { enabled: false }) as any).is_enabled).toBe(false);
  });

  it("keeps the trajectory grouping when sharing a trajectory evaluator", () => {
    expect(sharedTrajectoryRule("s-2", source)).toMatchObject({
      session_id: "s-2",
      filter: ONLINE_FILTER,
      group_by: "trajectory_id",
      evaluator_id: "ev-1",
    });
  });

  it("refuses a source rule without an evaluator", () => {
    expect(() =>
      sharedRule({ kind: "session", sessionId: "s-1" }, { ...source, evaluatorId: null }),
    ).toThrow(/no evaluator/);
  });
});
