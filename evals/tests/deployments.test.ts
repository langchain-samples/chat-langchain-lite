import { describe, expect, it } from "vitest";

import {
  corsOrigins,
  createBody,
  deploymentSecrets,
  findAgentDeployment,
  findGithubSource,
  mergeSecrets,
  revisionState,
  waitUntilDeployed,
} from "../src/deployments.ts";
import { fakeApi } from "./fake-api.ts";

const source = { integrationId: "int-1", repoUrl: "https://github.com/me/chat-langchain-lite" };
const signIn = { organizationId: "org-1", clientId: "lsc_1" };

describe("createBody", () => {
  it("binds the deployment to the agent environment and builds its branch's agent/ on push", () => {
    const body = createBody("development", source, { deploymentType: "dev", secrets: [] });
    expect(body.agent).toEqual({ agent_id: "chat-langchain-lite", environment: "development" });
    expect(body.source_config).toMatchObject({ integration_id: "int-1", build_on_push: true });
    expect(body.source_revision_config).toEqual({
      repo_ref: "development",
      langgraph_config_path: "agent",
    });
    expect(createBody("production", source, { deploymentType: "prod", secrets: [] })).toMatchObject(
      { source_revision_config: { repo_ref: "main" } },
    );
  });

  it("sets both CORS lists, keeping the LangSmith UI and the fork's Pages site", () => {
    const cors = corsOrigins("Me");
    expect(cors.split(",")).toEqual([
      "https://smith.langchain.com",
      "https://me.github.io",
      "http://localhost:5173",
    ]);
    const names = deploymentSecrets({ gatewayKey: "g", cors, signIn })
      .filter((secret) => secret.value === cors)
      .map((secret) => secret.name);
    expect(names).toEqual(["MDA_CORS_ORIGINS", "CORS_ALLOW_ORIGINS"]);
  });
});

describe("deploymentSecrets", () => {
  it("gives the agent the org and OAuth app it admits, leaving the client id out until it exists", () => {
    const names = (clientId: string | null) =>
      deploymentSecrets({ gatewayKey: "g", cors: "", signIn: { ...signIn, clientId } }).map(
        (secret) => secret.name,
      );
    expect(names("lsc_1")).toEqual(
      expect.arrayContaining(["ALLOWED_ORGANIZATION_ID", "OAUTH_CLIENT_ID"]),
    );
    expect(names(null)).not.toContain("OAUTH_CLIENT_ID");
  });
});

describe("mergeSecrets", () => {
  const current = [
    { name: "MDA_INGRESS_SECRET", value: "minted" },
    { name: "OAUTH_CLIENT_ID", value: "lsc_old" },
  ];

  it("is null when every desired secret already has its value", () => {
    expect(mergeSecrets(current, [{ name: "OAUTH_CLIENT_ID", value: "lsc_old" }])).toBeNull();
  });

  it("updates and adds secrets while keeping the ones the platform minted", () => {
    expect(
      mergeSecrets(current, [
        { name: "OAUTH_CLIENT_ID", value: "lsc_new" },
        { name: "ALLOWED_ORGANIZATION_ID", value: "org-1" },
      ]),
    ).toEqual([
      { name: "MDA_INGRESS_SECRET", value: "minted" },
      { name: "OAUTH_CLIENT_ID", value: "lsc_new" },
      { name: "ALLOWED_ORGANIZATION_ID", value: "org-1" },
    ]);
  });
});

describe("revisionState", () => {
  it("treats any failed or abandoned build as final", () => {
    expect(revisionState("DEPLOYED")).toBe("deployed");
    expect(revisionState("BUILD_FAILED")).toBe("failed");
    expect(revisionState("INTERRUPTED")).toBe("failed");
    expect(revisionState("AWAITING_BUILD")).toBe("pending");
  });
});

describe("findAgentDeployment", () => {
  it("skips the environment's preview deployments", async () => {
    const api = fakeApi(() => ({
      resources: [
        { id: "p", name: "preview", is_preview: true },
        { id: "d", name: "development", is_preview: false },
      ],
    }));
    expect((await findAgentDeployment(api, "development"))?.id).toBe("d");
  });
});

describe("findGithubSource", () => {
  it("pages through installations and repositories, keeping GitHub's spelling of the URL", async () => {
    const api = fakeApi(({ path, query }) => {
      const cursor = (query as { cursor?: string }).cursor;
      if (path === "/v2/integrations/github/installations")
        return cursor
          ? { items: [{ id: "mine" }] }
          : { items: [{ id: "other" }], next_cursor: "next" };
      if (path.includes("/other/")) return { items: [] };
      return cursor
        ? { items: [{ url: "https://github.com/Me/Chat-LangChain-Lite" }] }
        : { items: [{ url: "https://github.com/me/x" }], next_cursor: "2" };
    });
    expect(await findGithubSource(api, "me/chat-langchain-lite")).toEqual({
      integrationId: "mine",
      repoUrl: "https://github.com/Me/Chat-LangChain-Lite",
    });
  });
});

describe("waitUntilDeployed", () => {
  const deployment = (status: string, active: string | null) =>
    fakeApi(({ path }) =>
      path.includes("/revisions/")
        ? { status, status_message: "npm ci failed" }
        : { id: "d", name: "dev", latest_revision_id: "r2", active_revision_id: active },
    );

  it("returns at once when the latest revision is live", async () => {
    expect((await waitUntilDeployed(deployment("DEPLOYED", "r2"), "d", () => {})).id).toBe("d");
  });

  it("stops on a failed first build instead of treating the deployment as installed", async () => {
    await expect(
      waitUntilDeployed(deployment("BUILD_FAILED", null), "d", () => {}),
    ).rejects.toThrow(/BUILD_FAILED: npm ci failed\. Fix it, then re-run with --redeploy/);
  });
});
