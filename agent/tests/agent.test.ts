import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { getHarnessProfile } from "deepagents";
import { AIMessage } from "langchain";
import type { ManagedServerRuntime } from "managed-deepagents";
import { beforeAll, describe, expect, it } from "vitest";

import { agent, CUTOFF_NOTICE, cutoffNoticeMiddleware } from "../agent.js";

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

describe("cutoffNoticeMiddleware", () => {
  type Hook = (request: unknown, handler: () => AIMessage) => Promise<AIMessage>;
  const { wrapModelCall } = cutoffNoticeMiddleware as unknown as { wrapModelCall: Hook };
  const respond = (message: AIMessage) => wrapModelCall({}, () => message);

  it("tells the user when Anthropic stopped a final answer at max_tokens", async () => {
    const message = new AIMessage({
      content: [{ type: "text", text: "See the [docs](https://docs.langchain.com/oss/" }],
      additional_kwargs: { stop_reason: "max_tokens" },
    });
    expect((await respond(message)).text).toContain(CUTOFF_NOTICE);
  });

  it("tells the user when OpenAI stopped a final answer for length", async () => {
    const message = new AIMessage({
      content: "Here is the code:\n```python\nagent = create_agent(",
      response_metadata: { finish_reason: "length" },
    });
    expect((await respond(message)).text).toBe(`${message.content}\n\n${CUTOFF_NOTICE}`);
  });

  it("leaves tool-call turns and finished answers alone", async () => {
    const toolTurn = new AIMessage({
      content: "",
      tool_calls: [{ id: "1", name: "search_docs", args: { query: "middleware" } }],
      additional_kwargs: { stop_reason: "max_tokens" },
    });
    const finished = new AIMessage({
      content: "Done.",
      additional_kwargs: { stop_reason: "end_turn" },
      response_metadata: { finish_reason: "stop" },
    });
    expect(await respond(toolTurn)).toBe(toolTurn);
    expect(await respond(finished)).toBe(finished);
  });
});
