import { ASSISTANT_ID, type Environment } from "./agent.ts";
import { ApiError, type Api } from "./api.ts";

export const ENVIRONMENT_BRANCHES: Readonly<Record<Environment, string>> = {
  production: "main",
  development: "development",
};

/** Engine labels its fix PRs with the trigger label; a labeled PR into development gets a preview. */
export const PREVIEW_CONFIG = {
  enabled: true,
  trigger_mode: "label",
  trigger_label: "preview",
  preview_base_branch: null,
  // Idle means no PR activity, which agent traffic doesn't count as. Fix PRs stay open until a reset.
  ttl_seconds: null,
  max_concurrent_previews: 10,
} as const;

export interface DeploymentRecord {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly is_preview?: boolean;
  readonly url?: string | null;
  readonly status?: string;
  readonly latest_revision_id: string | null;
  readonly active_revision_id: string | null;
  readonly tracer_session_id: string | null;
  readonly secrets?: readonly Secret[];
}

export interface GithubSource {
  readonly integrationId: string;
  readonly repoUrl: string;
}

/** smith.langchain.com keeps the LangSmith UI (Deployments, Studio) able to reach the agent. */
export function corsOrigins(owner: string): string {
  return `https://smith.langchain.com,https://${owner.toLowerCase()}.github.io,http://localhost:5173`;
}

export interface Secret {
  readonly name: string;
  readonly value: string;
}

/** Who "Sign in with LangSmith" admits. agent/access.ts reads these secrets. */
export interface SignInSettings {
  readonly organizationId: string;
  /** Null until an org admin registers the OAuth app; the agent then refuses every OAuth token. */
  readonly clientId: string | null;
}

export function deploymentSecrets(options: {
  readonly gatewayKey: string;
  readonly cors: string;
  readonly signIn: SignInSettings;
}): Secret[] {
  return [
    { name: "LANGSMITH_GATEWAY_API_KEY", value: options.gatewayKey },
    { name: "MDA_CORS_ORIGINS", value: options.cors },
    // mda deploy derives this for the Agent Server's own routes; GitHub builds don't, so set it here.
    { name: "CORS_ALLOW_ORIGINS", value: options.cors },
    { name: "ALLOWED_ORGANIZATION_ID", value: options.signIn.organizationId },
    ...(options.signIn.clientId
      ? [{ name: "OAUTH_CLIENT_ID", value: options.signIn.clientId }]
      : []),
  ];
}

/**
 * The deployment's secrets with `desired` applied, or null when none change.
 * Keeps every other secret: PATCH sends the full list, and the platform minted some of them.
 */
export function mergeSecrets(
  current: readonly Secret[],
  desired: readonly Secret[],
): Secret[] | null {
  const values = new Map(current.map((secret) => [secret.name, secret.value]));
  if (desired.every((secret) => values.get(secret.name) === secret.value)) return null;
  for (const secret of desired) values.set(secret.name, secret.value);
  return [...values].map(([name, value]) => ({ name, value }));
}

/** Don't switch to POST /v2/managed-deep-agents: it can't bind a deployment to an agent environment. */
export function createBody(
  environment: Environment,
  source: GithubSource,
  options: { readonly deploymentType: string; readonly secrets: readonly Secret[] },
) {
  return {
    agent: { agent_id: ASSISTANT_ID, environment },
    source: "github",
    managed_deep_agent: true,
    source_config: {
      integration_id: source.integrationId,
      repo_url: source.repoUrl,
      deployment_type: options.deploymentType,
      build_on_push: true,
    },
    source_revision_config: {
      repo_ref: ENVIRONMENT_BRANCHES[environment],
      langgraph_config_path: "agent",
    },
    secrets: options.secrets,
  };
}

export type RevisionState = "deployed" | "failed" | "pending";

export function revisionState(status: string): RevisionState {
  if (status === "DEPLOYED") return "deployed";
  if (/FAILED$|^(SKIPPED|INTERRUPTED)$/.test(status)) return "failed";
  return "pending";
}

export async function findAgentDeployment(
  hostApi: Api,
  environment: Environment,
): Promise<DeploymentRecord | null> {
  const response = await hostApi.get<{ resources?: DeploymentRecord[] }>("/v2/deployments", {
    agent_id: ASSISTANT_ID,
    agent_environment: environment,
  });
  return (response.resources ?? []).find((record) => !record.is_preview) ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The old deployment's row blocks a new one for its environment until its background delete finishes. */
export async function createWhenEnvironmentFree(
  hostApi: Api,
  body: ReturnType<typeof createBody>,
  log: (message: string) => void,
): Promise<DeploymentRecord> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await hostApi.post<DeploymentRecord>("/v2/deployments", body);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409) || attempt >= 60) throw error;
      if (attempt === 0)
        log(`waiting for the old ${body.agent.environment} deployment to finish deleting`);
      await sleep(15_000);
    }
  }
}

export async function waitUntilDeployed(
  hostApi: Api,
  deploymentId: string,
  log: (message: string) => void,
): Promise<DeploymentRecord> {
  let last = "";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const deployment = await hostApi.get<DeploymentRecord>(`/v2/deployments/${deploymentId}`);
    const revisionId = deployment.latest_revision_id;
    if (revisionId) {
      const revision = await hostApi.get<{ status: string; status_message?: string | null }>(
        `/v2/deployments/${deploymentId}/revisions/${revisionId}`,
      );
      if (revision.status !== last) log(`  ${deployment.name}: ${(last = revision.status)}`);
      const state = revisionState(revision.status);
      if (state === "failed")
        throw new Error(
          `${deployment.name} revision ${revisionId} ${revision.status}: ${revision.status_message ?? "see the deployment in LangSmith"}. Fix it, then re-run with --redeploy.`,
        );
      if (state === "deployed" && deployment.active_revision_id === revisionId) return deployment;
    }
    await sleep(15_000);
  }
  throw new Error(`${deploymentId} didn't finish deploying in 30 minutes. Check it in LangSmith.`);
}

async function* pages<T>(hostApi: Api, path: string): AsyncGenerator<T> {
  let cursor: string | undefined;
  do {
    const page = await hostApi.get<{ items: T[]; next_cursor?: string | null }>(path, { cursor });
    yield* page.items;
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
}

/** The LangSmith GitHub integration that can see `repo` (owner/name). Engine's GitHub App is a separate one. */
export async function findGithubSource(hostApi: Api, repo: string): Promise<GithubSource | null> {
  const wanted = `https://github.com/${repo}`.toLowerCase();
  for await (const installation of pages<{ id: string }>(
    hostApi,
    "/v2/integrations/github/installations",
  )) {
    for await (const candidate of pages<{ url: string }>(
      hostApi,
      `/v2/integrations/github/installations/${installation.id}/repositories`,
    )) {
      // Keep GitHub's spelling: push and preview webhooks match the stored repo URL exactly.
      if (candidate.url.toLowerCase() === wanted)
        return { integrationId: installation.id, repoUrl: candidate.url };
    }
  }
  return null;
}
