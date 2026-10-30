type FetchFn = typeof fetch;

export type BranchGap =
  | { readonly kind: "ahead"; readonly commits: number }
  | { readonly kind: "even" }
  | { readonly kind: "unknown"; readonly reason: string };

/** `owner/repo` from a GitHub HTTPS or SSH remote URL, or null for anything else. */
export function parseGitHubRepo(remoteUrl: string): string | null {
  const match = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return match ? match[1]! : null;
}

/** How many commits `development` has that `main` doesn't, from GitHub's compare API. */
export async function developmentGap(
  repo: string,
  { token, fetchFn = fetch }: { readonly token?: string; readonly fetchFn?: FetchFn } = {},
): Promise<BranchGap> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await fetchFn(
      `https://api.github.com/repos/${repo}/compare/main...development`,
      { headers },
    );
    if (!response.ok) return { kind: "unknown", reason: `GitHub returned ${response.status}` };
    const { ahead_by: commits } = (await response.json()) as { ahead_by: number };
    return commits > 0 ? { kind: "ahead", commits } : { kind: "even" };
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}
