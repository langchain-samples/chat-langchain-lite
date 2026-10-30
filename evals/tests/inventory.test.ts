import { describe, expect, it } from "vitest";

import { ApiError } from "../src/api.ts";
import {
  DELETION_ORDER,
  deletionPlan,
  discoverInventory,
  type Inventory,
  renderInventory,
} from "../src/inventory.ts";
import { fakeApi } from "./fake-api.ts";

const removal = (path: string) => ({ api: "smith" as const, path });
const empty: Inventory = {
  agent: [],
  deployments: [],
  contextHubRepos: [],
  projects: [],
  datasets: [],
  referenceDatasets: [],
  experiments: [],
  evaluators: [],
  rules: [],
  prompts: [],
  queues: [],
  feedbackConfigs: [],
};

describe("deletionPlan", () => {
  it("deletes evaluators before their prompts, and rules before both", () => {
    const order = DELETION_ORDER.indexOf.bind(DELETION_ORDER);
    expect(order("rules")).toBeLessThan(order("evaluators"));
    expect(order("evaluators")).toBeLessThan(order("prompts"));
    expect(order("rules")).toBeLessThan(order("referenceDatasets"));
    expect(order("queues")).toBeLessThan(order("feedbackConfigs"));
  });

  it("skips what another delete removes", () => {
    const plan = deletionPlan({
      ...empty,
      queues: [
        { id: "aq-1", name: "alignment", removedWith: "evaluator tone" },
        { id: "q-1", name: "triage", removal: removal("/annotation-queues/q-1") },
      ],
      experiments: [{ id: "e-1", name: "baseline", removedWith: "dataset x" }],
      prompts: [{ id: "p", name: "p", removal: removal("/repos/-/p") }],
      evaluators: [{ id: "ev", name: "tone", removal: removal("/platform/evaluators/ev") }],
    });
    expect(plan.map((step) => step.item.id)).toEqual(["ev", "p", "q-1"]);
  });
});

describe("renderInventory", () => {
  it("says how each item goes", () => {
    const text = renderInventory({
      ...empty,
      queues: [{ id: "aq-1", name: "alignment", removedWith: "evaluator tone" }],
      rules: [{ id: "r-1", name: "Alignment" }],
    });
    expect(text).toContain("[removed with evaluator tone]");
    expect(text).toContain("[can't be removed through the API]");
  });
});

describe("discoverInventory", () => {
  it("leaves alignment queues to their evaluator and skips hidden system evaluators", async () => {
    const api = fakeApi(({ path, query }) => {
      const q = (query ?? {}) as Record<string, unknown>;
      if (path === "/agents/chat-langchain-lite") throw new ApiError(404, path, "");
      if (path === "/sessions")
        return q.name === "chat-langchain-lite-production"
          ? [{ id: "s-prod", name: "chat-langchain-lite-production" }]
          : [];
      if (path === "/datasets")
        return q.name
          ? [{ id: "ds-1", name: "chat-langchain-lite" }]
          : [{ id: "ref-1", name: "Evaluator: chat-langchain-lite:tone (ev1) – tone" }];
      if (path === "/runs/rules") {
        if (q.session_id === "s-prod")
          return [
            {
              id: "r-1",
              display_name: "tone",
              session_name: "p",
              evaluator_id: "ev-1",
              is_enabled: true,
            },
          ];
        if (q.dataset_id === "ref-1")
          return [
            {
              id: "r-a",
              display_name: "Alignment",
              dataset_name: "ref",
              evaluator_id: "sys-1",
              is_enabled: true,
            },
          ];
        return [];
      }
      if (path === "/platform/evaluators") return { evaluators: [] };
      if (path === "/platform/evaluators/ev-1")
        return {
          id: "ev-1",
          name: "tone",
          llm_evaluator: {
            prompt_id: "p-1",
            prompt_repo_handle: "eval_chat_langchain_lite_tone_p1",
            annotation_queue_id: "aq-1",
            corrections_dataset_id: "ref-1",
          },
        };
      if (path === "/platform/evaluators/sys-1") throw new ApiError(404, path, "");
      if (path === "/repos/") return { repos: [] };
      if (path === "/annotation-queues")
        return [{ id: "aq-1", name: "Evaluator: chat-langchain-lite:tone (ev1) – tone" }];
      if (path === "/feedback-configs") return [];
      if (path.startsWith("/repos/-/")) throw new ApiError(404, path, "");
      if (path === "/v2/deployments") return { resources: [] };
      throw new Error(`unexpected ${path}`);
    });

    const inventory = await discoverInventory(api, api);
    expect(inventory.evaluators.map((item) => item.id)).toEqual(["ev-1"]);
    expect(inventory.queues).toEqual([
      expect.objectContaining({ id: "aq-1", removedWith: "evaluator tone" }),
    ]);
    expect(inventory.prompts.map((item) => item.removal?.path)).toEqual([
      "/repos/-/eval_chat_langchain_lite_tone_p1",
    ]);
    expect(inventory.rules.map((item) => item.id)).toEqual(["r-1", "r-a"]);
    expect(api.calls.some((call) => call.method !== "GET")).toBe(false);
  });
});

describe("discoverInventory deployments", () => {
  const discover = (repos: Record<string, { tags: string[] }>) => {
    const api = fakeApi(({ path, query }) => {
      const q = (query ?? {}) as Record<string, unknown>;
      if (path === "/v2/deployments")
        return q.agent_environment === "development"
          ? {
              resources: [
                { id: "dev", name: "a-chat-lan-development-1" },
                { id: "pr-7", name: "a-chat-lan-development-1-pr-7", is_preview: true },
              ],
            }
          : { resources: [] };
      const handle = path.startsWith("/repos/-/") ? path.slice("/repos/-/".length) : null;
      if (handle && repos[handle])
        return { repo: { id: `hub-${handle}`, repo_type: "agent", tags: repos[handle].tags } };
      if (handle || path === "/agents/chat-langchain-lite") throw new ApiError(404, path, "");
      if (path === "/platform/evaluators") return { evaluators: [] };
      if (path === "/repos/") return { repos: [] };
      if (["/sessions", "/datasets", "/annotation-queues", "/feedback-configs"].includes(path))
        return [];
      throw new Error(`unexpected ${path}`);
    });
    return discoverInventory(api, api);
  };

  it("leaves previews and the build's own Context Hub repo to the deployment", async () => {
    const inventory = await discover({
      "a-chat-lan-development-1": { tags: ["managed-deepagents", "managed-deepagents:github"] },
    });
    expect(inventory.deployments).toEqual([
      expect.objectContaining({ id: "dev", removal: expect.anything() }),
      expect.objectContaining({ id: "pr-7", removedWith: "the development deployment" }),
    ]);
    expect(inventory.contextHubRepos).toEqual([
      expect.objectContaining({
        name: "a-chat-lan-development-1",
        removedWith: "the development deployment",
      }),
    ]);
  });

  it("skips a same-name repo the build didn't create, and deletes legacy repos as directories", async () => {
    const inventory = await discover({
      "a-chat-lan-development-1": { tags: [] },
      "chat-langchain-lite": { tags: ["managed-deepagents"] },
    });
    expect(inventory.contextHubRepos).toEqual([
      expect.objectContaining({
        name: "chat-langchain-lite",
        removal: {
          api: "smith",
          path: "/platform/hub/repos/-/chat-langchain-lite/directories",
          query: { repo_type: "agent" },
        },
      }),
    ]);
  });
});
