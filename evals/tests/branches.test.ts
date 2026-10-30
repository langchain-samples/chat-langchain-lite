import { describe, expect, it } from "vitest";

import { developmentGap, parseGitHubRepo } from "../src/branches.ts";

const respond = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status });

describe("parseGitHubRepo", () => {
  it("reads owner/repo from HTTPS and SSH remotes", () => {
    expect(parseGitHubRepo("https://github.com/acme/chat-langchain-lite.git")).toBe(
      "acme/chat-langchain-lite",
    );
    expect(parseGitHubRepo("git@github.com:acme/chat-langchain-lite.git\n")).toBe(
      "acme/chat-langchain-lite",
    );
    expect(parseGitHubRepo("https://gitlab.com/acme/chat-langchain-lite.git")).toBeNull();
  });
});

describe("developmentGap", () => {
  it("reports how far development is ahead of main", async () => {
    expect(await developmentGap("acme/repo", { fetchFn: respond(200, { ahead_by: 3 }) })).toEqual({
      kind: "ahead",
      commits: 3,
    });
    expect(await developmentGap("acme/repo", { fetchFn: respond(200, { ahead_by: 0 }) })).toEqual({
      kind: "even",
    });
  });

  it("reports unknown instead of throwing when GitHub can't answer", async () => {
    expect(await developmentGap("acme/repo", { fetchFn: respond(404, {}) })).toEqual({
      kind: "unknown",
      reason: "GitHub returned 404",
    });
  });
});
