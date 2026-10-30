/** A signed-in user's credential, presented the way each service expects it. */
export interface Session {
  readonly kind: "langsmith" | "pat";
  /**
   * Set for key sign-ins only. Keys reach the agent through the platform scheme, whose users can
   * search every thread, so the app filters by owner itself; OAuth callers see only their own.
   */
  readonly ownerId?: string;
  /** Fresh on every call: OAuth access tokens last five minutes. */
  agentHeaders(): Promise<Record<string, string>>;
  apiHeaders(): Promise<Record<string, string>>;
  signOut(): Promise<void>;
}

export function bearerHeaders(accessToken: string, workspaceId: string): Record<string, string> {
  // The token names the user's default workspace; the deployment's may be another.
  return { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": workspaceId };
}

export function withHeaders(
  init: RequestInit | undefined,
  extra: Record<string, string>,
): RequestInit {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return { ...init, headers };
}

/** `fetch` with the session's LangSmith API credential added to each request. */
export function apiFetch(session: Session, fetchFn: typeof fetch = fetch): typeof fetch {
  return async (input, init) => fetchFn(input, withHeaders(init, await session.apiHeaders()));
}
