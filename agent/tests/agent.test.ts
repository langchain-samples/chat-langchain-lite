import { ChatAnthropic } from "@langchain/anthropic";
import { GraphInterrupt } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { getHarnessProfile } from "deepagents";
import { AIMessage, createAgent, fakeModel, tool, ToolMessage } from "langchain";
import type { ManagedServerRuntime } from "managed-deepagents";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { accessMiddleware, accessPolicy } from "../access.js";
import { agent, toolErrors } from "../agent.js";

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

  it("handles tool errors after the access check", () => {
    const middleware = agent(runtimeWith({})).config.middleware;
    expect(middleware[0].name).toBe("access");
    expect(middleware).toContain(toolErrors);
  });
});

describe("toolErrors", () => {
  const search = (query: string) => ({ name: "search_docs", args: { query }, id: `call-${query}` });
  const searchDocs = tool(
    ({ query }) => {
      if (query === "slow") throw new Error("Request timed out");
      return `docs for ${query}`;
    },
    { name: "search_docs", description: "Search docs", schema: z.object({ query: z.string() }) },
  );

  it("lets the model answer from the other searches when one fails", async () => {
    const model = fakeModel()
      .respondWithTools([search("fast"), search("slow")])
      .respond(new AIMessage("answer"));
    const run = createAgent({
      model,
      tools: [searchDocs],
      middleware: [accessMiddleware(accessPolicy({})), toolErrors],
    });

    const { messages } = await run.invoke({ messages: [{ role: "user", content: "compare" }] });

    const results = messages.filter(ToolMessage.isInstance);
    expect(results.find((m) => m.tool_call_id === "call-fast")).toMatchObject({
      content: "docs for fast",
    });
    expect(results.find((m) => m.tool_call_id === "call-slow")).toMatchObject({
      name: "search_docs",
      status: "error",
      content: expect.stringMatching(/search_docs failed.*tell the user this lookup failed/),
    });
    expect(messages.at(-1)?.content).toBe("answer");
  });

  it("rethrows interrupts instead of turning them into results", async () => {
    type Hook = (request: unknown, handler: () => Promise<unknown>) => Promise<unknown>;
    const wrapToolCall = (toolErrors as unknown as { wrapToolCall: Hook }).wrapToolCall;
    const interrupt = new GraphInterrupt();
    await expect(
      wrapToolCall({ toolCall: search("slow") }, () => Promise.reject(interrupt)),
    ).rejects.toBe(interrupt);
  });
});
