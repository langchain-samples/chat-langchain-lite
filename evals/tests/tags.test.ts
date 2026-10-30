import { describe, expect, it } from "vitest";

import { ApiError } from "../src/api.ts";
import { tagAgentResources, taggablesFor } from "../src/tags.ts";
import { QUEUE_NAME } from "../src/triage.ts";
import { fakeApi } from "./fake-api.ts";

describe("taggablesFor", () => {
  it("tags each LLM evaluator's prompt, and skips the queue when there is none", () => {
    expect(
      taggablesFor("ds-1", undefined, [
        { id: "ev-llm", llm_evaluator: { prompt_id: "prompt-1" } },
        { id: "ev-code", llm_evaluator: null },
      ]),
    ).toEqual([
      { type: "dataset", id: "ds-1" },
      { type: "evaluator", id: "ev-llm" },
      { type: "prompt", id: "prompt-1" },
      { type: "evaluator", id: "ev-code" },
    ]);
  });

  it("tags an LLM evaluator's alignment queue", () => {
    expect(
      taggablesFor("ds-1", undefined, [
        { id: "ev-1", llm_evaluator: { prompt_id: "prompt-1", annotation_queue_id: "aq-1" } },
      ]),
    ).toContainEqual({ type: "queue", id: "aq-1" });
  });
});

describe("tagAgentResources", () => {
  it("tags the dataset before listing the agent's evaluators", async () => {
    const api = fakeApi(({ method, path }) => {
      if (path === "/agents/chat-langchain-lite")
        return { tag_value_id: "tv-1", environments: [{ tracer_session_id: "s-1" }] };
      if (path === "/platform/evaluators")
        return { evaluators: [{ id: "ev-1", llm_evaluator: { prompt_id: "p-1" } }] };
      if (path === "/annotation-queues") return [{ id: "q-1", name: QUEUE_NAME }];
      if (method === "POST") return {};
      throw new Error(`unexpected ${method} ${path}`);
    });

    expect(await tagAgentResources(api, "ds-1")).toBe(5);
    const order = api.calls.map((call) => `${call.method} ${call.path}`);
    expect(order.indexOf("POST /workspaces/current/taggings")).toBeLessThan(
      order.indexOf("GET /platform/evaluators"),
    );
    const tagged = api.calls
      .filter((call) => call.method === "POST")
      .map((call) => call.body as { resource_type: string; resource_id: string });
    expect(new Set(tagged.map((body) => `${body.resource_type}:${body.resource_id}`))).toEqual(
      new Set(["dataset:ds-1", "queue:q-1", "project:s-1", "evaluator:ev-1", "prompt:p-1"]),
    );
  });

  it("skips tagging when the workspace has no Agent tag", async () => {
    const missing = fakeApi(() => {
      throw new ApiError(404, "/agents/chat-langchain-lite", "");
    });
    const untagged = fakeApi(() => ({ tag_value_id: null }));

    expect(await tagAgentResources(missing, "ds-1")).toBeNull();
    expect(await tagAgentResources(untagged, "ds-1")).toBeNull();
    expect(untagged.calls).toHaveLength(1);
  });
});
