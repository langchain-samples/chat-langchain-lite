import { describe, expect, it } from "vite-plus/test";

import { textOf, toTurns, type MessageLike } from "./turns";

const human = (id: string, content: string): MessageLike => ({ id, type: "human", content });

describe("textOf", () => {
  it("joins text blocks and ignores the rest", () => {
    expect(textOf("plain")).toBe("plain");
    expect(
      textOf([{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }]),
    ).toBe("ab");
    expect(textOf(undefined)).toBe("");
  });
});

describe("toTurns", () => {
  const conversation: MessageLike[] = [
    human("h1", "What is LangGraph?"),
    {
      id: "a1",
      type: "ai",
      content: [{ type: "text", text: "Let me search." }],
      tool_calls: [
        { id: "c1", name: "search", args: { q: "langgraph" } },
        { id: "c2", name: "read", args: {} },
      ],
    },
    { type: "tool", tool_call_id: "c1", content: "results" },
    { type: "tool", tool_call_id: "c2", content: "boom", status: "error" },
    { id: "a2", type: "ai", content: "LangGraph is..." },
    human("h2", "Thanks"),
    { id: "a3", type: "ai", content: "", tool_calls: [{ id: "c3", name: "search" }] },
  ];

  it("groups by human message and pairs tool results", () => {
    const [first] = toTurns(conversation, { streaming: false });
    expect(first!.userText).toBe("What is LangGraph?");
    expect(first!.segments.map((s) => s.kind)).toEqual(["text", "tools", "text"]);
    const tools = first!.segments[1];
    expect(tools?.kind === "tools" && tools.toolCalls.map((c) => c.status)).toEqual([
      "succeeded",
      "failed",
    ]);
    expect(tools?.kind === "tools" && tools.toolCalls[1]!.error).toBe("boom");
  });

  it("marks unanswered calls running only while the last turn streams", () => {
    const status = (streaming: boolean) => {
      const last = toTurns(conversation, { streaming }).at(-1)!.segments[0];
      return last?.kind === "tools" ? last.toolCalls[0]!.status : undefined;
    };
    expect(status(true)).toBe("running");
    expect(status(false)).toBe("canceled");
  });

  it("skips empty assistant text", () => {
    expect(
      toTurns(conversation, { streaming: false })
        .at(-1)!
        .segments.map((s) => s.kind),
    ).toEqual(["tools"]);
  });
});
