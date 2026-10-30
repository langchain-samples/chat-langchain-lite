import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import { Input } from "@langchain/macaw-components/Input";
import { Link } from "@langchain/macaw-components/Link";
import { Text } from "@langchain/macaw-components/Text";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr/Buildings";
import { useState, type FormEvent } from "react";

import { LANGSMITH_APP_URL } from "../chat/langsmith";
import type { AgentEnvironment } from "../config";
import type { Account } from "./lastAccount";
import type { LangSmithSignIn } from "./oauth";
import { agentKeyHeaders, keyOwnerId, verifyPat } from "./pat";
import type { SignInProblem } from "./useSession";

interface SignInProps {
  readonly environment: AgentEnvironment;
  readonly workspaceId: string;
  /** Null when the build has no OAuth app; only personal access tokens work then. */
  readonly langsmith: LangSmithSignIn | null;
  readonly problem?: SignInProblem;
  readonly lastAccount: Account | null;
  readonly onForgetAccount: () => void;
  readonly onSignIn: (pat: string, ownerId: string) => void;
}

export function SignIn({
  environment,
  workspaceId,
  langsmith,
  problem,
  lastAccount,
  onForgetAccount,
  onSignIn,
}: SignInProps) {
  const wrongOrganization = problem?.kind === "wrong-organization" ? problem : null;
  const [pat, setPat] = useState("");
  const [showKey, setShowKey] = useState(!langsmith);
  const [busy, setBusy] = useState<"langsmith" | "key" | null>(null);
  const [error, setError] = useState<string | null>(
    problem?.kind === "error" ? problem.message : null,
  );

  const startLangSmith = async () => {
    setBusy("langsmith");
    setError(null);
    try {
      await langsmith!.start({ chooseOrganization: wrongOrganization !== null });
    } catch (cause) {
      setBusy(null);
      setError(cause instanceof Error ? cause.message : "Couldn't reach LangSmith.");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("key");
    setError(null);
    const key = pat.trim();
    const result = await verifyPat(fetch, environment.url, agentKeyHeaders(key, workspaceId));
    if (!result.ok) {
      setBusy(null);
      return setError(result.message);
    }
    try {
      onSignIn(key, await keyOwnerId(fetch, key, workspaceId));
    } catch (cause) {
      setBusy(null);
      setError(cause instanceof Error ? cause.message : "Couldn't check that key.");
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-surface-level-1 p-space-4">
      <div className="flex w-full max-w-md flex-col gap-space-4 rounded-lg border border-default bg-surface-level-2 p-space-6">
        <div className="flex flex-col gap-space-1">
          <Text variant="h4">Chat LangChain Lite</Text>
          <Text variant="sm" color="secondary">
            {langsmith
              ? "Sign in with your LangSmith account. Deployed Engineering members only."
              : "Sign in with a LangSmith personal access token from a member of this workspace. It stays in this tab only."}
          </Text>
        </div>
        {langsmith ? (
          <>
            {wrongOrganization ? (
              <Banner intent="warning" title="That account isn't in Deployed Engineering">
                LangSmith signed you in
                {wrongOrganization.email ? ` as ${wrongOrganization.email}` : ""} for another
                organization.{" "}
                {langsmith.singleSignOn ? (
                  "Try again to sign in through Deployed Engineering's single sign-on."
                ) : (
                  <>
                    If Deployed Engineering uses a different login, such as Okta, sign out at{" "}
                    <Link href={LANGSMITH_APP_URL} target="_blank" rel="noreferrer">
                      smith.langchain.com
                    </Link>
                    , sign in with that login, then try again.
                  </>
                )}
              </Banner>
            ) : null}
            {lastAccount && !wrongOrganization ? (
              <div className="flex flex-col gap-space-2">
                <Text variant="xs" color="tertiary">
                  Last used
                </Text>
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-busy={busy === "langsmith"}
                  onClick={() => void startLangSmith()}
                  className="flex w-full items-center gap-space-3 rounded-md border border-default bg-surface-level-1 p-space-4 text-left hover:bg-surface-level-1-hover disabled:opacity-60"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-level-2">
                    <BuildingsIcon size={20} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Text as="span" variant="body" className="truncate">
                      {lastAccount.email}
                    </Text>
                    <Text as="span" variant="xs" color="secondary">
                      {langsmith.singleSignOn ? "Single sign-on" : "LangSmith"}
                    </Text>
                  </span>
                  <ArrowRightIcon size={18} />
                </button>
                <Button variant="outlined" disabled={busy !== null} onClick={onForgetAccount}>
                  Use another account
                </Button>
              </div>
            ) : (
              <Button
                size="md"
                loading={busy === "langsmith"}
                disabled={busy !== null}
                onClick={() => void startLangSmith()}
              >
                {wrongOrganization ? "Try again" : "Sign in with LangSmith"}
              </Button>
            )}
            <Button
              variant="plain"
              size="sm"
              aria-expanded={showKey}
              onClick={() => setShowKey((shown) => !shown)}
            >
              {showKey ? "Hide advanced" : "Advanced"}
            </Button>
            {showKey ? (
              <Text variant="xs" color="tertiary">
                Use a personal access token from a member of this workspace instead. It stays in
                this tab only.
              </Text>
            ) : null}
          </>
        ) : null}
        {showKey ? (
          <>
            <form onSubmit={submit} className="flex flex-col gap-space-4">
              <Input
                type="password"
                label="LangSmith personal access token"
                placeholder="lsv2_pt_…"
                value={pat}
                debounceMs={0}
                onChange={setPat}
                autoFocus={!langsmith}
                required
              />
              <Button
                type="submit"
                variant={langsmith ? "outlined" : "normal"}
                loading={busy === "key"}
                disabled={!pat.trim() || busy !== null}
              >
                {langsmith ? "Sign in with token" : "Sign in"}
              </Button>
            </form>
            <Text variant="xs" color="tertiary">
              Checked against the {environment.label.toLowerCase()} agent.
            </Text>
          </>
        ) : null}
        {error ? <Banner intent="error">{error}</Banner> : null}
      </div>
    </main>
  );
}
