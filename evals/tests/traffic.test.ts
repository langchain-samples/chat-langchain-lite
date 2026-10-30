import { describe, expect, it } from "vitest";

import type { AskResult } from "../src/agent.ts";
import { planConversations, planFeedback, sample, summarize } from "../src/traffic.ts";

const answer = (runId: string, text: string, outputTokens = 100): AskResult => ({
  runId,
  threadId: `thread-${runId}`,
  answer: { text, outputTokens },
});

const results = [
  answer("cut", "Step 1…", 900),
  answer("emoji", "Sure thing 🚀"),
  answer("good-1", "Use create_agent."),
  answer("good-2", "Set LANGSMITH_TRACING."),
];

describe("planFeedback", () => {
  it("thumbs-down incomplete and informal answers, and thumbs-up good ones, within the caps", () => {
    expect(
      planFeedback(results, {
        outputLimit: 900,
        incompleteThumbsDown: 1,
        informalThumbsDown: 1,
        okThumbsUp: 1,
      }),
    ).toEqual([
      { runId: "cut", score: 0, comment: "It stops in the middle of the answer." },
      { runId: "emoji", score: 0, comment: "Not very professional for a docs assistant." },
      { runId: "good-1", score: 1 },
    ]);
  });

  it("sends no thumbs-up when the cap is zero", () => {
    const plan = planFeedback(results, {
      outputLimit: 900,
      incompleteThumbsDown: 5,
      informalThumbsDown: 3,
      okThumbsUp: 0,
    });
    expect(plan.every((entry) => entry.score === 0)).toBe(true);
    expect(summarize(5, results, plan, 900)).toEqual({
      sent: 4,
      failed: 1,
      incomplete: 1,
      informal: 1,
      thumbsDown: 2,
      thumbsUp: 0,
    });
  });
});

/** Cycles through fixed values, so random choices repeat. */
const sequence = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length]!;
};

describe("sample", () => {
  it("picks distinct items, never more than there are", () => {
    const picked = sample(["a", "b", "c", "d"], 3, sequence(0.9, 0.1, 0.5));
    expect(new Set(picked).size).toBe(3);
    expect(sample(["a", "b"], 5, Math.random)).toHaveLength(2);
  });
});

describe("planConversations", () => {
  it("adds a follow-up turn when the draw falls under the rate", () => {
    const conversations = planConversations(
      ["q1", "q2"],
      ["f1", "f2"],
      { count: 2, followUpRate: 0.5 },
      sequence(0, 0, 0.2, 0.9, 0.9),
    );
    expect(conversations).toHaveLength(2);
    expect(conversations.filter((conversation) => conversation.followUp)).toHaveLength(1);
  });

  it("never adds follow-ups when there are none to choose from", () => {
    const conversations = planConversations(["q1"], [], { count: 1, followUpRate: 1 }, Math.random);
    expect(conversations).toEqual([{ question: "q1" }]);
  });
});
