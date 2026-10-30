import { describe, expect, it } from "vite-plus/test";

import { groupThreads, mergeRunIds, relativeTime, toThreadSummaries } from "./threads";

describe("toThreadSummaries", () => {
  it("titles threads from the first message and truncates long ones", () => {
    const [short, long, empty] = toThreadSummaries([
      { thread_id: "a", updated_at: "1", extracted: { first: "What is   LangGraph?" } },
      {
        thread_id: "b",
        updated_at: "2",
        extracted: { first: [{ type: "text", text: "x".repeat(80) }] },
      },
      { thread_id: "c", updated_at: "3" },
    ]);
    expect(short!.title).toBe("What is LangGraph?");
    expect(long!.title).toHaveLength(60);
    expect(long!.title.endsWith("…")).toBe(true);
    expect(empty!.title).toBe("Untitled conversation");
  });

  it("prefers the stored metadata title", () => {
    const [row] = toThreadSummaries([
      {
        thread_id: "a",
        updated_at: "1",
        metadata: { title: "Stored title" },
        extracted: { first: "Extracted" },
      },
    ]);
    expect(row!.title).toBe("Stored title");
  });
});

describe("mergeRunIds", () => {
  it("orders history by creation time and appends live runs without duplicates", () => {
    const history = [
      { run_id: "r2", created_at: "2026-10-17T10:00:02Z" },
      { run_id: "r1", created_at: "2026-10-17T10:00:01Z" },
    ];
    expect(mergeRunIds(history, ["r2", "r3"])).toEqual(["r1", "r2", "r3"]);
  });
});

describe("groupThreads", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const thread = (id: string, title: string, updatedAt: string) => ({ id, title, updatedAt });
  const threads = [
    thread("a", "LangGraph checkpoints", "2026-10-17T11:00:00Z"),
    thread("b", "Tracing setup", "2026-10-16T08:00:00Z"),
    thread("c", "Deep Agents vs LangGraph", "2026-10-13T12:00:00Z"),
    thread("d", "Old question", "2026-09-01T12:00:00Z"),
  ];

  it("buckets by age and drops empty groups", () => {
    expect(groupThreads(threads, now).map((g) => [g.label, g.threads.map((t) => t.id)])).toEqual([
      ["Today", ["a"]],
      ["Yesterday", ["b"]],
      ["Previous 7 days", ["c"]],
      ["Older", ["d"]],
    ]);
  });

  it("filters by title, case-insensitively", () => {
    expect(
      groupThreads(threads, now, "langgraph").flatMap((g) => g.threads.map((t) => t.id)),
    ).toEqual(["a", "c"]);
    expect(groupThreads(threads, now, "nothing")).toEqual([]);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  it.each([
    ["2026-10-17T11:59:40Z", "Just now"],
    ["2026-10-17T11:59:00Z", "1 min ago"],
    ["2026-10-17T09:00:00Z", "3 hours ago"],
    ["2026-10-16T10:00:00Z", "Yesterday"],
    ["2026-10-14T12:00:00Z", "3 days ago"],
    ["2026-10-03T12:00:00Z", "2 weeks ago"],
    ["2026-08-01T12:00:00Z", "2 months ago"],
  ])("%s → %s", (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });
});
