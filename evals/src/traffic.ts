import { ask, looksInformal, usedWholeBudget, type AskResult } from "./agent.ts";
import type { Api } from "./api.ts";
import { mapPool } from "./pool.ts";

export interface FeedbackOptions {
  readonly outputLimit: number;
  readonly incompleteThumbsDown: number;
  readonly informalThumbsDown: number;
  readonly okThumbsUp: number;
}

export interface TrafficOptions extends FeedbackOptions {
  readonly concurrency: number;
}

export type Verdict = "incomplete" | "informal" | "ok";

export interface Plan {
  readonly runId: string;
  readonly score: 0 | 1;
  readonly comment?: string;
}

export function verdictOf(result: AskResult, outputLimit: number): Verdict {
  if (usedWholeBudget(result.answer, outputLimit)) return "incomplete";
  if (looksInformal(result.answer.text)) return "informal";
  return "ok";
}

/** Simulated users: a few thumbs-down answers that look incomplete or informal, and thumbs-up some good ones. */
export function planFeedback(results: readonly AskResult[], options: FeedbackOptions): Plan[] {
  const verdicts = results.map((result) => ({
    result,
    verdict: verdictOf(result, options.outputLimit),
  }));
  const pick = (verdict: Verdict, count: number, score: 0 | 1, comment?: string) =>
    verdicts
      .filter((entry) => entry.verdict === verdict)
      .slice(0, count)
      .map((entry) => ({ runId: entry.result.runId, score, ...(comment ? { comment } : {}) }));
  return [
    ...pick("incomplete", options.incompleteThumbsDown, 0, "It stops in the middle of the answer."),
    ...pick(
      "informal",
      options.informalThumbsDown,
      0,
      "Not very professional for a docs assistant.",
    ),
    ...pick("ok", options.okThumbsUp, 1),
  ];
}

export async function sendFeedback(platformApi: Api, plan: readonly Plan[]): Promise<void> {
  for (const { runId, score, comment } of plan) {
    await platformApi.post("/feedback", { run_id: runId, key: "user_score", score, comment });
  }
}

export interface TrafficSummary {
  readonly sent: number;
  readonly failed: number;
  readonly incomplete: number;
  readonly informal: number;
  readonly thumbsDown: number;
  readonly thumbsUp: number;
}

export function summarize(
  asked: number,
  results: readonly AskResult[],
  plan: readonly Plan[],
  outputLimit: number,
): TrafficSummary {
  const verdicts = results.map((result) => verdictOf(result, outputLimit));
  return {
    sent: results.length,
    failed: asked - results.length,
    incomplete: verdicts.filter((verdict) => verdict === "incomplete").length,
    informal: verdicts.filter((verdict) => verdict === "informal").length,
    thumbsDown: plan.filter((entry) => entry.score === 0).length,
    thumbsUp: plan.filter((entry) => entry.score === 1).length,
  };
}

export async function sendTraffic(
  agentApi: Api,
  platformApi: Api,
  questions: readonly string[],
  options: TrafficOptions,
): Promise<TrafficSummary> {
  const settled = await mapPool(questions, options.concurrency, (question) =>
    ask(agentApi, question, { metadata: { source: "demo-prepare-traffic" } }).catch(
      () => undefined,
    ),
  );
  const results = settled.filter((result): result is AskResult => result !== undefined);
  const plan = planFeedback(results, options);
  await sendFeedback(platformApi, plan);
  return summarize(settled.length, results, plan, options.outputLimit);
}

/** `count` distinct items in random order. */
export function sample<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  for (let index = 0; index < Math.min(count, pool.length); index += 1) {
    const swap = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }
  return pool.slice(0, count);
}

export interface Conversation {
  readonly question: string;
  readonly followUp?: string;
}

/** Each question, some with a follow-up turn, the way people keep asking. */
export function planConversations(
  questions: readonly string[],
  followUps: readonly string[],
  options: { readonly count: number; readonly followUpRate: number },
  random: () => number,
): Conversation[] {
  return sample(questions, options.count, random).map((question) =>
    random() < options.followUpRate && followUps.length > 0
      ? { question, followUp: followUps[Math.floor(random() * followUps.length)]! }
      : { question },
  );
}
