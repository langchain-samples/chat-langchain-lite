export interface Config {
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly apiUrl: string;
  readonly hostUrl: string;
}

export function readConfig(env: Record<string, string | undefined>): Config {
  const missing = ["LANGSMITH_API_KEY", "LANGSMITH_WORKSPACE_ID"].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(" and ")}. Locally they come from agent/.env and mise.local.toml; in CI, from repo secrets and variables.`,
    );
  }
  return {
    apiKey: env.LANGSMITH_API_KEY!,
    workspaceId: env.LANGSMITH_WORKSPACE_ID!,
    apiUrl: `${env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com"}/api/v1`,
    hostUrl: env.LANGSMITH_HOST_URL ?? "https://api.host.langchain.com",
  };
}
