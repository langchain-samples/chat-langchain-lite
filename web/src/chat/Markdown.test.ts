import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Markdown } from "./Markdown";

function hrefOf(text: string) {
  return /href="([^"]*)"/.exec(renderToStaticMarkup(createElement(Markdown, { text })))?.[1];
}

describe("Markdown links", () => {
  it("points root-relative docs paths at the docs site", () => {
    expect(hrefOf("[Evaluators](/langsmith/evaluators#view-evaluators)")).toBe(
      "https://docs.langchain.com/langsmith/evaluators#view-evaluators",
    );
  });

  it("leaves absolute URLs and in-page anchors unchanged", () => {
    expect(
      hrefOf("[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)"),
    ).toBe("https://docs.langchain.com/oss/python/langgraph/persistence");
    expect(hrefOf("[Example](https://example.com/page)")).toBe("https://example.com/page");
    expect(hrefOf("[Below](#setup)")).toBe("#setup");
  });
});
