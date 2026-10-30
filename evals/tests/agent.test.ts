import { describe, expect, it } from "vitest";

import { contentText, finalAnswer, looksInformal, usedWholeBudget } from "../src/agent.ts";

describe("finalAnswer", () => {
  it("reads the last AI message's text and output tokens from blocks or strings", () => {
    const messages = [
      { type: "human", content: "hi" },
      {
        type: "ai",
        content: [
          { type: "text", text: "Hey " },
          { type: "text", text: "there" },
        ],
        usage_metadata: { output_tokens: 12 },
      },
    ];
    expect(finalAnswer(messages)).toEqual({ text: "Hey there", outputTokens: 12 });
    expect(contentText("plain")).toBe("plain");
  });
});

describe("usedWholeBudget / looksInformal", () => {
  it("flags a reply that used the whole output budget", () => {
    expect(usedWholeBudget({ text: "", outputTokens: 900 }, 900)).toBe(true);
    expect(usedWholeBudget({ text: "", outputTokens: 640 }, 900)).toBe(false);
  });

  it("flags emoji as informal", () => {
    expect(looksInformal("Have fun! 🚀")).toBe(true);
    expect(looksInformal("A checkpointer saves state.")).toBe(false);
  });
});
