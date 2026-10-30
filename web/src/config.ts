// Must match `name` in agent/agent.ts: it is the assistant id and the tracing-project prefix.
export const ASSISTANT_ID = "chat-langchain-lite";

export type EnvironmentId = "production" | "development";

export interface AgentEnvironment {
  readonly id: EnvironmentId;
  readonly label: string;
  readonly url: string;
  /** Tracing project the agent platform creates per environment. */
  readonly projectName: string;
}

/** The "Sign in with LangSmith" OAuth app, and the org whose members the agent admits. */
export interface LangSmithApp {
  readonly clientId: string;
  readonly organizationId: string;
  /** The org's SSO login (`/sso/login/<slug>`); null when it has none. */
  readonly ssoSlug: string | null;
}

export interface AppConfig {
  readonly environments: readonly AgentEnvironment[];
  readonly workspaceId: string;
  /** Null offers only personal access tokens. */
  readonly langsmithApp: LangSmithApp | null;
}

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; problems: readonly string[] };

type Env = Record<string, string | undefined>;

const ENVIRONMENT_VARS: ReadonlyArray<readonly [EnvironmentId, string, string]> = [
  ["production", "Production", "VITE_AGENT_URL_PRODUCTION"],
  ["development", "Development", "VITE_AGENT_URL_DEVELOPMENT"],
];

export function parseConfig(env: Env): ConfigResult {
  const environments = ENVIRONMENT_VARS.flatMap(([id, label, key]) => {
    const url = env[key]?.trim().replace(/\/+$/, "");
    return url ? [{ id, label, url, projectName: `${ASSISTANT_ID}-${id}` }] : [];
  });
  const workspaceId = env.VITE_LANGSMITH_WORKSPACE_ID?.trim() ?? "";
  const clientId = env.VITE_OAUTH_CLIENT_ID?.trim() ?? "";
  const organizationId = env.VITE_LANGSMITH_ORGANIZATION_ID?.trim() ?? "";
  const ssoSlug = env.VITE_LANGSMITH_SSO_SLUG?.trim() || null;

  const problems = [
    ...(environments.length
      ? []
      : ["Set VITE_AGENT_URL_PRODUCTION or VITE_AGENT_URL_DEVELOPMENT."]),
    ...(workspaceId ? [] : ["Set VITE_LANGSMITH_WORKSPACE_ID."]),
    ...(clientId && !organizationId
      ? ["Set VITE_LANGSMITH_ORGANIZATION_ID, or unset VITE_OAUTH_CLIENT_ID."]
      : []),
  ];
  if (problems.length) return { ok: false, problems };
  const langsmithApp = clientId ? { clientId, organizationId, ssoSlug } : null;
  return { ok: true, config: { environments, workspaceId, langsmithApp } };
}

export function findEnvironment(config: AppConfig, id: string | null): AgentEnvironment {
  return (
    config.environments.find((environment) => environment.id === id) ?? config.environments[0]!
  );
}
