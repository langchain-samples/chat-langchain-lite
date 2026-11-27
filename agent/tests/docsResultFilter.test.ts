import { createDeepAgent } from "deepagents";
import { FakeToolCallingModel, HumanMessage, ToolMessage, tool } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { docsResultFilterMiddleware, stripComponentSource } from "../docsResultFilter.js";

const PROSE =
  'Stream custom data from a tool with `get_stream_writer`.\n\n<PatternEmbed pattern="x" />';

function component(lines = 0) {
  return [
    'export const PatternEmbed = ({pattern, theme = "light", onReady}) => {',
    '  const urls = { react: `${BASE}/react?p=${encodeURIComponent(pattern)}`, label: "}{" };',
    ...Array.from(
      { length: lines },
      (_, i) => `  const step${i} = { id: ${i}, nested: { label: "step ${i}" } };`,
    ),
    "  if (theme) {",
    "    onReady?.({ urls });",
    "  }",
    "  return <div className={`lc ${theme}`}>Don't {pattern}</div>;",
    "};",
  ].join("\n");
}

function searchResult(source: string) {
  return `Title: Custom data\nLink: https://docs.langchain.com/x\nPage: x\nContent: ${source}\n\n${PROSE}`;
}

describe("stripComponentSource", () => {
  it("removes a component definition with nested braces and keeps the page around it", () => {
    const stripped = stripComponentSource(searchResult(component()));
    expect(stripped).not.toContain("export const");
    expect(stripped).not.toContain("onReady");
    expect(stripped).toContain("Title: Custom data\nLink: https://docs.langchain.com/x");
    expect(stripped).toContain(PROSE);
  });

  it("removes object definitions at the start of a line, as in a raw page", () => {
    const page = `# Streaming\n\nexport const config = { a: { b: "}" } };\n\n${PROSE}`;
    expect(stripComponentSource(page)).toBe(`# Streaming\n\n\n\n${PROSE}`);
  });

  it("leaves text without a closed arrow-function or object definition alone", () => {
    for (const text of [
      "Use `export const x = 1;` to export a value.",
      "export const answer = 42;\n\nprose",
      "Content: export const Broken = () => {\n  return (\n\nprose",
    ]) {
      expect(stripComponentSource(text)).toBe(text);
    }
  });

  it("brings a search result past the eviction threshold well under it", () => {
    const result = searchResult(component(2000));
    expect(result.length).toBeGreaterThan(100_000);
    expect(stripComponentSource(result).length).toBeLessThan(1_000);
  });
});

describe("docsResultFilterMiddleware", () => {
  type Hook = (request: unknown, handler: () => Promise<unknown>) => Promise<unknown>;
  const wrapToolCall = docsResultFilterMiddleware().wrapToolCall as unknown as Hook;
  const call = (name: string, content: ToolMessage["content"]) =>
    wrapToolCall(
      { toolCall: { name, id: "1", args: {} } },
      async () => new ToolMessage({ content, tool_call_id: "1", name }),
    ) as Promise<ToolMessage>;

  it("strips text blocks of docs results and keeps other blocks", async () => {
    const image = { type: "image", url: "https://example.com/a.png" };
    const result = await call("langchainDocs_search_docs_by_lang_chain", [
      { type: "text", text: searchResult(component()) },
      image,
    ] as ToolMessage["content"]);
    expect(result.content).toEqual([
      { type: "text", text: stripComponentSource(searchResult(component())) },
      image,
    ]);
  });

  it("strips string docs results", async () => {
    const result = await call(
      "langchainDocs_query_docs_filesystem_docs_by_lang_chain",
      searchResult(component()),
    );
    expect(result.content).not.toContain("export const");
  });

  it("leaves other tools' results unchanged", async () => {
    const text = searchResult(component());
    expect((await call("read_file", text)).content).toBe(text);
  });

  it("filters before Deep Agents evicts large tool results", async () => {
    const search = tool(async () => searchResult(component(2000)), {
      name: "langchainDocs_search_docs_by_lang_chain",
      description: "Search the docs.",
      schema: z.object({ query: z.string() }),
    });
    const run = async (middleware: ReturnType<typeof docsResultFilterMiddleware>[]) => {
      const agent = createDeepAgent({
        model: new FakeToolCallingModel({
          toolCalls: [[{ name: search.name, args: { query: "streaming" }, id: "call_1" }]],
        }),
        tools: [search],
        middleware,
      });
      const { messages } = await agent.invoke({ messages: [new HumanMessage("streaming?")] });
      return String(messages.find(ToolMessage.isInstance)?.content);
    };

    expect(await run([])).toContain("/large_tool_results/");
    const filtered = await run([docsResultFilterMiddleware()]);
    expect(filtered).not.toContain("/large_tool_results/");
    expect(filtered).not.toContain("export const");
    expect(filtered).toContain(PROSE);
  });
});
