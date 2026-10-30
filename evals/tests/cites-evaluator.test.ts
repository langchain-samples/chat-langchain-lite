import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type Score = { key: string; score: number; comment: string };
const code = readFileSync(
  new URL("../evaluators/cites-retrieved-docs.js", import.meta.url),
  "utf8",
);
const performEval = new Function(`${code}\nreturn performEval;`)() as (
  run: unknown,
  example?: unknown,
) => Score[];

const lc = (type: string, kwargs: Record<string, unknown>) => ({
  lc: 1,
  type: "constructor",
  id: ["langchain_core", "messages", type],
  kwargs,
});
const search = (text: string) =>
  lc("ToolMessage", {
    name: "langchainDocs_search_docs_by_lang_chain",
    content: [{ type: "text", text }],
  });
const answer = (content: unknown) => lc("AIMessage", { content });
const scores = (messages: unknown[]) =>
  Object.fromEntries(
    performEval({ outputs: { messages } }).map((score) => [score.key, score.score]),
  );

describe("cites_retrieved_docs", () => {
  const retrieved = search(
    "Title: Persistence\nLink: https://docs.langchain.com/oss/python/langgraph/persistence#checkpoints",
  );

  it("passes when every cited docs link came from the search results", () => {
    const cited = answer([
      { type: "text", text: "See https://docs.langchain.com/oss/python/langgraph/persistence." },
    ]);
    expect(scores([retrieved, cited])).toEqual({ searched_docs: 1, cites_retrieved_docs: 1 });
  });

  it("fails a link the search never returned, and handles plain-string content", () => {
    const cited = answer("See https://docs.langchain.com/oss/python/langgraph/streaming");
    expect(scores([retrieved, cited])).toEqual({ searched_docs: 1, cites_retrieved_docs: 0 });
  });

  it("scores a run that never searched as 0 on both", () => {
    expect(scores([answer("Sure, here's a recipe.")])).toEqual({
      searched_docs: 0,
      cites_retrieved_docs: 0,
    });
  });

  it("accepts pages the filesystem tool returned as paths", () => {
    const fs = lc("ToolMessage", {
      name: "langchainDocs_query_docs_filesystem_docs_by_lang_chain",
      content: "/oss/python/langgraph/interrupts.mdx",
    });
    const cited = answer("Docs: https://docs.langchain.com/oss/python/langgraph/interrupts");
    expect(scores([fs, cited])).toEqual({ searched_docs: 1, cites_retrieved_docs: 1 });
  });
});
