import { createAgent, FakeToolCallingModel, tool, ToolMessage } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { mcpToolAliases, toolAliasMiddleware } from "../tool-aliases.js";

const readDocs = tool(async ({ path }) => `contents of ${path}`, {
  name: "langchainDocs_query_docs_filesystem_docs_by_lang_chain",
  description: "Read a docs page.",
  schema: z.object({ path: z.string() }),
});

async function toolReply(name: string) {
  const agent = createAgent({
    model: new FakeToolCallingModel({
      toolCalls: [[{ id: "call-1", name, args: { path: "/oss/streaming" } }], []],
    }),
    tools: [readDocs],
    middleware: [toolAliasMiddleware()],
  });
  const { messages } = await agent.invoke({ messages: [{ role: "user", content: "hi" }] });
  return messages.find(ToolMessage.isInstance);
}

describe("toolAliasMiddleware", () => {
  it("maps every declared docs tool to its prefixed name", () => {
    expect([...mcpToolAliases()]).toEqual([
      ["search_docs_by_lang_chain", "langchainDocs_search_docs_by_lang_chain"],
      [
        "query_docs_filesystem_docs_by_lang_chain",
        "langchainDocs_query_docs_filesystem_docs_by_lang_chain",
      ],
    ]);
  });

  it("runs a docs tool called by its bare MCP name, replying under the prefixed name", async () => {
    const reply = await toolReply("query_docs_filesystem_docs_by_lang_chain");
    expect(reply?.status).not.toBe("error");
    expect(reply?.content).toBe("contents of /oss/streaming");
    expect(reply?.name).toBe("langchainDocs_query_docs_filesystem_docs_by_lang_chain");
  });

  it("leaves prefixed and unknown tool names alone", async () => {
    const prefixed = await toolReply("langchainDocs_query_docs_filesystem_docs_by_lang_chain");
    expect(prefixed?.content).toBe("contents of /oss/streaming");
    const unknown = await toolReply("not_a_tool");
    expect(unknown?.status).toBe("error");
    expect(unknown?.content).toMatch(/not_a_tool is not a valid tool/);
  });
});
