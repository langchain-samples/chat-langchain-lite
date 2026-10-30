import { spawnSync } from "node:child_process";

/** owner/name from an https or ssh GitHub remote URL. */
export function parseGithubRepo(remoteUrl: string): string {
  const match = remoteUrl.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error(`origin is not a GitHub repo: ${remoteUrl}`);
  return match[1]!;
}

/** The fork's repo. gh's own default here can be the upstream repo, so always pass this with -R. */
export function originRepo(): string {
  return parseGithubRepo(run("git", ["remote", "get-url", "origin"]));
}

/** Runs a command and returns its stdout. `input` goes to stdin, so secrets never appear in argv or logs. */
export function run(command: string, args: readonly string[], input?: string): string {
  const result = spawnSync(command, args, { encoding: "utf8", input });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

export interface WorkflowRun {
  readonly databaseId: number;
  readonly createdAt: string;
}

/** The run a dispatch just started: the newest one created at or after `since`. */
export function runSince(runs: readonly WorkflowRun[], since: Date): WorkflowRun | undefined {
  return runs
    .filter((candidate) => new Date(candidate.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Merges need a green `check` (CI's job) and `merge-guard`, which holds Engine's fixes open; admins can still push directly. */
export function branchProtection() {
  return {
    required_status_checks: {
      strict: false,
      checks: [{ context: "check" }, { context: "merge-guard" }],
    },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
  };
}

export const MAINTAINERS_ENVIRONMENT = "maintainers";

export function maintainersEnvironment(reviewerId: number) {
  return { reviewers: [{ type: "User", id: reviewerId }], prevent_self_review: false };
}

export function checklist(repo: string): string[] {
  return [
    `GitHub ${repo}, Settings → Secrets and variables → Actions:`,
    "  variables LANGSMITH_WORKSPACE_ID, VITE_AGENT_URL_DEVELOPMENT, VITE_AGENT_URL_PRODUCTION",
    "  secrets LANGSMITH_API_KEY (and LANGSMITH_GATEWAY_API_KEY, if an older install set it)",
    `GitHub ${repo}, Settings → Branches: the main and development protection rules`,
    `GitHub ${repo}, Settings → Pages: unpublish the site, then delete the github-pages environment`,
    `GitHub ${repo}, Settings → Environments: the ${MAINTAINERS_ENVIRONMENT} environment`,
    "GitHub, Settings → Applications: LangSmith's and Engine's GitHub Apps, if nothing else uses them",
    "Local: agent/.env and mise.local.toml (your keys), agent/.mda/, evals/.prepare/",
  ];
}
