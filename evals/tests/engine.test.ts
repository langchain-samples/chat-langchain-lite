import { describe, expect, it } from "vitest";

import { ApiError } from "../src/api.ts";
import {
  boardProblems,
  boardSettings,
  createBoardBody,
  deleteBoard,
  ensureBoard,
  isEngineFix,
  type EngineTargets,
  type PullRequest,
} from "../src/engine.ts";
import { fakeApi } from "./fake-api.ts";

const targets: EngineTargets = {
  repo: "me/chat-langchain-lite",
  production: { name: "a-chat-lan-production-1", tracer_session_id: "session-1" },
  development: { id: "dev-1" },
};

const healthy = {
  cron_enabled: true,
  auto_open_fix_pr: true,
  preview_verify_enabled: true,
  validation_deployment_id: "dev-1",
  github_repos: [
    { repo_url: "https://github.com/Me/chat-langchain-lite", base_branch: "development" },
  ],
};

describe("createBoardBody", () => {
  it("fixes agent/ on development and keeps experiments out of the scan", () => {
    expect(createBoardBody(targets)).toMatchObject({
      github_repos: [
        { repo_url: "me/chat-langchain-lite", subdir: "agent", base_branch: "development" },
      ],
      context_hub_repo_handle: "a-chat-lan-production-1",
      analysis_level: "reduced",
      run_filter: 'neq(metadata_key, "ls_experiment_id")',
    });
  });
});

describe("boardSettings", () => {
  it("scans, opens fix PRs and verifies them on development's previews, under a spend limit", () => {
    expect(boardSettings(targets)).toMatchObject({
      cron_enabled: true,
      auto_open_fix_pr: true,
      preview_verify_enabled: true,
      validation_deployment_id: "dev-1",
    });
    expect(Number(boardSettings(targets).session_lcu_spend_limit_monthly)).toBeGreaterThan(0);
  });
});

describe("boardProblems", () => {
  it("passes a board that scans and verifies fixes", () => {
    expect(boardProblems(healthy, targets)).toEqual([]);
  });

  it("names each setting that breaks the demo", () => {
    expect(
      boardProblems(
        { ...healthy, cron_enabled: false, validation_deployment_id: null, github_repos: [] },
        targets,
      ),
    ).toEqual([
      "scanning is paused",
      "fixes aren't verified against development",
      "its first repo isn't me/chat-langchain-lite on development",
    ]);
  });
});

describe("ensureBoard", () => {
  it("creates a missing board, then applies the settings", async () => {
    const api = fakeApi((call) => {
      if (call.method === "GET") throw new ApiError(404, call.path, "");
      return {};
    });
    await ensureBoard(api, targets, () => {});
    expect(api.calls.map((call) => call.method)).toEqual(["GET", "POST", "PATCH"]);
    expect(api.calls[1]!.path).toBe("/platform/sessions/session-1/issues-agent");
  });

  it("only updates an existing board, so it doesn't start another scan", async () => {
    const api = fakeApi(() => healthy);
    await ensureBoard(api, targets, () => {});
    expect(api.calls.map((call) => call.method)).toEqual(["GET", "PATCH"]);
  });
});

describe("deleteBoard", () => {
  it("treats a missing board as already deleted", async () => {
    const api = fakeApi((call) => {
      throw new ApiError(404, call.path, "");
    });
    expect(await deleteBoard(api, targets)).toBe(false);
  });
});

describe("isEngineFix", () => {
  const pr = (overrides: Partial<PullRequest>): PullRequest => ({
    number: 1,
    headRefName: "feature",
    author: { login: "someone" },
    labels: [],
    ...overrides,
  });

  it("matches Engine's branches, app author and label", () => {
    expect(isEngineFix(pr({ headRefName: "langsmith-engine/0f3c" }))).toBe(true);
    expect(isEngineFix(pr({ headRefName: "issues-agent/0f3c" }))).toBe(true);
    expect(isEngineFix(pr({ author: { login: "app/langsmith-engine" } }))).toBe(true);
    expect(isEngineFix(pr({ labels: [{ name: "Engine" }] }))).toBe(true);
  });

  it("leaves everyone else's PRs open", () => {
    expect(
      isEngineFix(pr({ headRefName: "development", author: { login: "app/github-actions" } })),
    ).toBe(false);
    expect(isEngineFix(pr({ labels: [{ name: "preview" }] }))).toBe(false);
  });
});
