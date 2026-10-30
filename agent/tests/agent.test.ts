import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { getHarnessProfile } from "deepagents";
import type { ManagedServerRuntime } from "managed-deepagents";
import { beforeAll, describe, expect, it } from "vitest";

import { agent } from "../agent.js";

function runtimeWith(context: Record<string, unknown>) {
  return { executionRuntime: { context } } as unknown as ManagedServerRuntime;
}

describe("agent factory", () => {
  beforeAll(() => {
    process.env.LANGSMITH_GATEWAY_API_KEY ??= "test-key";
  });

  it("uses Haiku unless the run picks another allowlisted model", () => {
    expect(agent(runtimeWith({})).config.model).toBeInstanceOf(ChatAnthropic);
    expect(agent(runtimeWith({ eval_model: "gpt-4o" })).config.model).toBeInstanceOf(ChatAnthropic);
    expect(agent(runtimeWith({ eval_model: "gpt-6-luna" })).config.model).toBeInstanceOf(
      ChatOpenAI,
    );
  });

  it("turns off the general-purpose subagent for both providers", () => {
    for (const spec of ["anthropic:claude-haiku-5-5", "openai:gpt-6-luna"]) {
      expect(getHarnessProfile(spec)?.generalPurposeSubagent?.enabled).toBe(false);
    }
  });
});
