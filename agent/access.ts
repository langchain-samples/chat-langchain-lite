import { createMiddleware } from "langchain";
import type { ManagedServerInfo } from "managed-deepagents";

/** Who may run the agent with a "Sign in with LangSmith" token. Install sets both as deployment secrets. */
export interface AccessPolicy {
  readonly organizationId?: string;
  readonly clientId?: string;
}

export function accessPolicy(env: Record<string, string | undefined>): AccessPolicy {
  return {
    organizationId: env.ALLOWED_ORGANIZATION_ID?.trim() || undefined,
    clientId: env.OAUTH_CLIENT_ID?.trim() || undefined,
  };
}

/** Why this caller may not run the agent, or null when it may. */
export function refusal(
  policy: AccessPolicy,
  serverInfo: ManagedServerInfo | undefined,
): string | null {
  // The Agent Server already checked the caller's LangSmith API key against this workspace.
  if (serverInfo?.source?.provider === "studio") return null;
  const principal = serverInfo?.principal;
  // Local `mda dev` callers. Hosted, every outside caller is a person or came through Studio.
  if (principal?.kind !== "person") return null;
  // LangSmith issues these tokens to any user of any OAuth app, so both checks are required.
  if (!policy.clientId || principal.claims.client_id !== policy.clientId)
    return "Sign in through the Chat LangChain Lite app to use this agent.";
  if (!policy.organizationId || principal.claims.organization_id !== policy.organizationId)
    return "Only members of this agent's LangSmith organization can use it.";
  return null;
}

export function accessMiddleware(policy: AccessPolicy) {
  return createMiddleware({
    name: "access",
    beforeAgent: (_state, runtime) => {
      const reason = refusal(policy, (runtime as { serverInfo?: ManagedServerInfo }).serverInfo);
      if (reason) throw new Error(reason);
      return undefined;
    },
  });
}
