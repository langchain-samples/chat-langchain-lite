import { describe, expect, it } from "vite-plus/test";

import { findProjectId, saveFeedback, traceUrl } from "./langsmith";

type Call = { url: string; init?: RequestInit };

function recordingFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("saveFeedback", () => {
  it("creates feedback on the root run with the user_score key", async () => {
    const { calls, fetchFn } = recordingFetch({ id: "fb-1" });
    const id = await saveFeedback({ fetchFn }, { runId: "run-1", score: 1 });
    expect(id).toBe("fb-1");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
      run_id: "run-1",
      key: "user_score",
      score: 1,
      comment: null,
    });
  });

  it("updates existing feedback instead of adding a second row", async () => {
    const { calls, fetchFn } = recordingFetch({ id: "fb-1" });
    await saveFeedback({ fetchFn }, { runId: "run-1", score: 0, comment: "cut off" }, "fb-1");
    expect(calls[0]!.url).toMatch(/\/api\/v1\/feedback\/fb-1$/);
    expect(calls[0]!.init?.method).toBe("PATCH");
  });

  it("surfaces API errors", async () => {
    const { fetchFn } = recordingFetch({}, 403);
    await expect(saveFeedback({ fetchFn }, { runId: "r", score: 1 })).rejects.toThrow(/403/);
  });
});

describe("trace links", () => {
  it("looks up the environment's tracing project by name", async () => {
    const { calls, fetchFn } = recordingFetch([{ id: "p-1" }]);
    expect(await findProjectId({ fetchFn }, "chat-langchain-lite-production")).toBe("p-1");
    expect(calls[0]!.url).toContain("name=chat-langchain-lite-production");
  });

  it("builds a run URL", () => {
    expect(traceUrl("ws", "p-1", "r-1")).toBe(
      "https://smith.langchain.com/o/ws/projects/p/p-1/r/r-1?trace_id=r-1",
    );
  });
});
