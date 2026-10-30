export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export const HEALTH_LABEL = "demo-health";
export const SCHEDULED_WORKFLOWS = ["trickle.yml", "health.yml"] as const;
// Engine stops for every workspace once the org reaches its cap; warn while there's still time.
const ORG_SPEND_WARNING = 0.95;

/** Runs one check; a throw is a failure, and its message is the detail. */
export async function check(name: string, run: () => Promise<string>): Promise<CheckResult> {
  try {
    return { name, ok: true, detail: await run() };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function renderReport(results: readonly CheckResult[]): string {
  return results
    .map((result) => `- ${result.ok ? "✅" : "❌"} **${result.name}**: ${result.detail}`)
    .join("\n");
}

export interface Spend {
  readonly projectLcu: number;
  readonly projectLimitLcu: number | null;
  readonly orgLcu: number;
  readonly orgLimitLcu: number | null;
}

export function spendProblems(spend: Spend): string[] {
  return [
    ...(spend.projectLimitLcu !== null && spend.projectLcu >= spend.projectLimitLcu
      ? [`the project reached its ${spend.projectLimitLcu} LCU limit, so Engine has stopped`]
      : []),
    ...(spend.orgLimitLcu !== null && spend.orgLcu >= spend.orgLimitLcu * ORG_SPEND_WARNING
      ? [`the org has used ${Math.round(spend.orgLcu)} of its ${spend.orgLimitLcu} LCU`]
      : []),
  ];
}

export function describeSpend(spend: Spend): string {
  const limit = spend.projectLimitLcu === null ? "no limit" : `limit ${spend.projectLimitLcu}`;
  const org = spend.orgLimitLcu === null ? "" : ` of ${spend.orgLimitLcu}`;
  return `${spend.projectLcu.toFixed(1)} LCU this month (${limit}); org ${Math.round(spend.orgLcu)}${org}`;
}

export type IssueAction =
  | { readonly kind: "open" }
  | { readonly kind: "comment"; readonly issue: number }
  | { readonly kind: "close"; readonly issue: number }
  | { readonly kind: "none" };

/** One open issue while anything fails; it closes once everything passes again. */
export function issueAction(
  openIssue: number | null,
  results: readonly CheckResult[],
): IssueAction {
  const failing = results.some((result) => !result.ok);
  if (failing) return openIssue === null ? { kind: "open" } : { kind: "comment", issue: openIssue };
  return openIssue === null ? { kind: "none" } : { kind: "close", issue: openIssue };
}
