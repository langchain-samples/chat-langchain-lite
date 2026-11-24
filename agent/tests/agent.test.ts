import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel, type BindToolsInput } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent, getHarnessProfile } from "deepagents";
import type { ManagedServerRuntime } from "managed-deepagents";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

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

  it("offers the model docs and file tools but no subagent tools, even with an async subagent", async () => {
    for (const provider of ["ChatAnthropic", "ChatOpenAI"]) {
      const model = new RecordingModel(provider);
      const docs = ["search_docs_by_lang_chain", "query_docs_filesystem_docs_by_lang_chain"].map(
        (name) => tool(async () => "", { name, description: name, schema: z.object({}) }),
      );
      await createDeepAgent({
        model,
        tools: docs,
        subagents: [
          { name: "general-purpose", description: "Runs in the background.", graphId: "gp" },
        ],
      }).invoke({ messages: [new HumanMessage("How do I add memory?")] });

      expect(model.offered).toEqual(
        expect.arrayContaining([
          "search_docs_by_lang_chain",
          "query_docs_filesystem_docs_by_lang_chain",
          "read_file",
        ]),
      );
      for (const name of [
        "task",
        "start_async_task",
        "check_async_task",
        "update_async_task",
        "cancel_async_task",
        "list_async_tasks",
      ]) {
        expect(model.offered).not.toContain(name);
      }
    }
  });
});

class RecordingModel extends BaseChatModel {
  offered: string[] = [];

  constructor(name: string) {
    super({});
    this.name = name;
  }

  _llmType() {
    return "recording";
  }

  override bindTools(tools: BindToolsInput[]) {
    this.offered = tools.map((t) => ("name" in t ? String(t.name) : ""));
    return this;
  }

  async _generate(): Promise<ChatResult> {
    return { generations: [{ text: "Done.", message: new AIMessage("Done.") }] };
  }
}
