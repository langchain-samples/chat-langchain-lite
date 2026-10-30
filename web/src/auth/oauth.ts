import { UserManager, WebStorageStateStore, type INavigator, type User } from "oidc-client-ts";

import { LANGSMITH_API_URL, LANGSMITH_APP_URL } from "../chat/langsmith";
import type { LangSmithApp } from "../config";
import type { Account } from "./lastAccount";
import { bearerHeaders, type Session } from "./session";

const RENEW_WITHIN_SECONDS = 30;

export type Resumed =
  | { readonly kind: "signed-in"; readonly session: Session; readonly account: Account | null }
  /** Approved for another org on LangSmith's consent page; that sign-in is already forgotten. */
  | { readonly kind: "wrong-organization"; readonly email: string | null };

export interface LangSmithSignIn {
  /** Sign-in goes through the org's SSO login, which also switches LangSmith accounts. */
  readonly singleSignOn: boolean;
  /**
   * Leaves for LangSmith's consent page; the current hash route comes back afterwards.
   * `chooseOrganization` shows the page even when the user approved the app before.
   */
  start(options?: { readonly chooseOrganization?: boolean }): Promise<void>;
  /** After LangSmith redirects back, or after a reload; null when signed out. */
  resume(location: Location): Promise<Resumed | null>;
}

export function isSignInCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("state") && (params.has("code") || params.has("error"));
}

/**
 * The org's SSO login, then LangSmith's consent page for the same request. Skipping
 * /oauth/authorize is safe: LangSmith repeats its checks when the user approves.
 */
export function ssoSignInUrl(authorizeUrl: string, ssoSlug: string): string {
  const url = new URL(`/sso/login/${encodeURIComponent(ssoSlug)}`, LANGSMITH_APP_URL);
  url.searchParams.set("redirect_to", `/oauth/consent${new URL(authorizeUrl).search}`);
  return url.href;
}

function redirectThrough(rewrite: (url: string) => string): INavigator {
  return {
    prepare: async () => ({
      navigate: ({ url }) =>
        new Promise((resolve) => {
          window.addEventListener("pageshow", () => resolve({ url: window.location.href }));
          window.location.assign(rewrite(url));
        }),
      close: () => undefined,
    }),
    callback: async () => undefined,
  };
}

/** The token's `organization_id` claim, unverified: the agent checks the signature. */
export function tokenOrganization(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload)) as { organization_id?: unknown };
    return typeof claims.organization_id === "string" ? claims.organization_id : null;
  } catch {
    return null;
  }
}

export function langsmithSignIn(options: {
  readonly app: LangSmithApp;
  readonly workspaceId: string;
  /** Registered on the OAuth app exactly, trailing slash included. */
  readonly redirectUri: string;
}): LangSmithSignIn {
  const { ssoSlug } = options.app;
  const store = new WebStorageStateStore({ store: window.sessionStorage });
  const manager = new UserManager(
    {
      authority: LANGSMITH_API_URL,
      client_id: options.app.clientId,
      redirect_uri: options.redirectUri,
      response_type: "code",
      scope: "openid email profile offline_access",
      // Without it the token only works at /userinfo; with it, at the agent and the LangSmith API.
      resource: LANGSMITH_API_URL,
      loadUserInfo: false,
      userStore: store,
      stateStore: store,
      // Renewal happens on demand in accessToken(), so two refreshes never race.
      automaticSilentRenew: false,
    },
    ssoSlug ? redirectThrough((url) => ssoSignInUrl(url, ssoSlug)) : undefined,
  );

  let renewal: Promise<User | null> | null = null;
  const accessToken = async () => {
    const user = await manager.getUser();
    if (!user) throw new Error("You're signed out. Reload to sign in again.");
    if ((user.expires_in ?? 0) > RENEW_WITHIN_SECONDS) return user.access_token;
    // Refresh tokens rotate, and LangSmith revokes them all when one is reused.
    renewal ??= manager.signinSilent().finally(() => {
      renewal = null;
    });
    const renewed = await renewal.catch(() => null);
    if (!renewed) {
      await manager.removeUser();
      throw new Error("Your LangSmith sign-in expired. Reload to sign in again.");
    }
    return renewed.access_token;
  };

  const forget = async () => {
    await manager.revokeTokens(["refresh_token"]).catch(() => undefined);
    await manager.removeUser();
  };
  const session: Session = {
    kind: "langsmith",
    agentHeaders: async () => bearerHeaders(await accessToken(), options.workspaceId),
    apiHeaders: async () => bearerHeaders(await accessToken(), options.workspaceId),
    signOut: forget,
  };
  // The agent refuses other orgs' tokens too; checking here turns that refusal into a way out.
  const admit = async (user: User): Promise<Resumed> => {
    if (tokenOrganization(user.access_token) === options.app.organizationId) {
      const { email } = user.profile;
      return { kind: "signed-in", session, account: email ? { email } : null };
    }
    await forget();
    return { kind: "wrong-organization", email: user.profile.email ?? null };
  };

  // StrictMode runs effects twice, and an authorization code works once.
  let callback: Promise<User> | null = null;
  return {
    singleSignOn: ssoSlug !== null,
    start: (start) =>
      manager.signinRedirect({
        state: { hash: window.location.hash },
        prompt: start?.chooseOrganization ? "consent" : undefined,
      }),
    resume: async (location) => {
      if (!isSignInCallback(location.search)) {
        const user = await manager.getUser();
        return user && (user.refresh_token || !user.expired) ? admit(user) : null;
      }
      try {
        callback ??= manager.signinRedirectCallback(location.href);
        const user = await callback;
        const hash = (user.state as { hash?: string } | undefined)?.hash ?? "";
        window.history.replaceState(null, "", location.pathname + hash);
        return await admit(user);
      } catch (error) {
        window.history.replaceState(null, "", location.pathname + location.hash);
        throw error;
      }
    },
  };
}
