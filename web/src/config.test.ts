import { describe, expect, it } from "vite-plus/test";

import { findEnvironment, parseConfig } from "./config";

const base = { VITE_LANGSMITH_WORKSPACE_ID: "ws-1" };

describe("parseConfig", () => {
  it("lists configured environments with production first and derives project names", () => {
    const result = parseConfig({
      ...base,
      VITE_AGENT_URL_DEVELOPMENT: "https://dev.example/",
      VITE_AGENT_URL_PRODUCTION: "https://prod.example",
    });
    expect(result.ok && result.config.environments).toEqual([
      {
        id: "production",
        label: "Production",
        url: "https://prod.example",
        projectName: "chat-langchain-lite-production",
      },
      {
        id: "development",
        label: "Development",
        url: "https://dev.example",
        projectName: "chat-langchain-lite-development",
      },
    ]);
  });

  it("works with only development deployed", () => {
    const result = parseConfig({ ...base, VITE_AGENT_URL_DEVELOPMENT: "http://localhost:2024" });
    expect(result.ok && result.config.environments.map((e) => e.id)).toEqual(["development"]);
  });

  it("offers Sign in with LangSmith only when the build names an OAuth app and its org", () => {
    const parsed = (env: Record<string, string>) => {
      const result = parseConfig({ ...base, VITE_AGENT_URL_PRODUCTION: "p", ...env });
      return result.ok ? result.config.langsmithApp : "invalid";
    };
    expect(
      parsed({ VITE_OAUTH_CLIENT_ID: " lsc_1 ", VITE_LANGSMITH_ORGANIZATION_ID: "org-1" }),
    ).toEqual({ clientId: "lsc_1", organizationId: "org-1", ssoSlug: null });
    expect(
      parsed({
        VITE_OAUTH_CLIENT_ID: "lsc_1",
        VITE_LANGSMITH_ORGANIZATION_ID: "org-1",
        VITE_LANGSMITH_SSO_SLUG: " slug ",
      }),
    ).toEqual({ clientId: "lsc_1", organizationId: "org-1", ssoSlug: "slug" });
    expect(parsed({ VITE_OAUTH_CLIENT_ID: "lsc_1" })).toBe("invalid");
    expect(parsed({})).toBeNull();
  });

  it("reports every missing setting", () => {
    const result = parseConfig({});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toHaveLength(2);
  });
});

describe("findEnvironment", () => {
  const result = parseConfig({
    ...base,
    VITE_AGENT_URL_PRODUCTION: "p",
    VITE_AGENT_URL_DEVELOPMENT: "d",
  });
  if (!result.ok) throw new Error("fixture");

  it("falls back to the first environment for unknown ids", () => {
    expect(findEnvironment(result.config, "development").id).toBe("development");
    expect(findEnvironment(result.config, "staging").id).toBe("production");
    expect(findEnvironment(result.config, null).id).toBe("production");
  });
});
