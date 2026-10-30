import { describe, expect, it } from "vitest";

import { parseGithubRepo, runSince } from "../src/github.ts";

describe("parseGithubRepo", () => {
  it("reads https and ssh remotes", () => {
    expect(parseGithubRepo("https://github.com/me/chat-langchain-lite.git")).toBe(
      "me/chat-langchain-lite",
    );
    expect(parseGithubRepo("git@github.com:me/chat-langchain-lite.git\n")).toBe(
      "me/chat-langchain-lite",
    );
  });

  it("refuses a remote that isn't GitHub", () => {
    expect(() => parseGithubRepo("https://gitlab.com/me/x.git")).toThrow(/not a GitHub repo/);
  });
});

describe("runSince", () => {
  it("picks the newest run started after the dispatch, not an older one", () => {
    const since = new Date("2026-10-19T12:00:00Z");
    expect(
      runSince(
        [
          { databaseId: 1, createdAt: "2026-10-19T11:59:00Z" },
          { databaseId: 3, createdAt: "2026-10-19T12:00:09Z" },
          { databaseId: 2, createdAt: "2026-10-19T12:00:05Z" },
        ],
        since,
      )?.databaseId,
    ).toBe(3);
    expect(runSince([{ databaseId: 1, createdAt: "2026-10-19T11:59:00Z" }], since)).toBeUndefined();
  });
});
