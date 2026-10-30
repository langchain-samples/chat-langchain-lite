import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { AGENT_OUTPUT_LIMIT, agentApi, ask, findDeployment, type AskResult } from "./agent.ts";
import { createApi } from "./api.ts";
import { readConfig } from "./config.ts";
import { mapPool } from "./pool.ts";
import { planConversations, planFeedback, sendFeedback, summarize } from "./traffic.ts";

const log = (line: string) => console.log(`[trickle] ${line}`);
const root = new URL("../", import.meta.url);
const metadata = { source: "demo-trickle" };

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, root), "utf8")) as T;
}

/** A few conversations with production, so there are always recent traces, feedback and Engine evidence. */
async function main() {
  const { values } = parseArgs({ options: { count: { type: "string", default: "4" } } });
  const config = readConfig(process.env);
  const client = (baseUrl: string) =>
    createApi({ baseUrl, apiKey: config.apiKey, workspaceId: config.workspaceId });
  const api = client(config.apiUrl);
  const production = agentApi(config, await findDeployment(client(config.hostUrl), "production"));

  const conversations = planConversations(
    await readJson<string[]>("dataset/traffic.json"),
    await readJson<string[]>("dataset/follow-ups.json"),
    { count: Number(values.count), followUpRate: 1 / 3 },
    Math.random,
  );
  const settled = await mapPool(conversations, 2, async ({ question, followUp }) => {
    try {
      const first = await ask(production, question, { metadata });
      if (!followUp) return first;
      return await ask(production, followUp, { metadata, threadId: first.threadId });
    } catch (error) {
      log(`failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  });
  const results = settled.filter((result): result is AskResult => result !== undefined);
  // People rate the answer they ended on.
  const plan = planFeedback(results, {
    outputLimit: AGENT_OUTPUT_LIMIT,
    incompleteThumbsDown: 1,
    informalThumbsDown: 1,
    okThumbsUp: 1,
  });
  await sendFeedback(api, plan);
  const summary = summarize(conversations.length, results, plan, AGENT_OUTPUT_LIMIT);
  log(
    `${JSON.stringify(summary)}, ${conversations.filter((entry) => entry.followUp).length} with a follow-up`,
  );
  if (results.length === 0) throw new Error("every conversation failed");
}

main().catch((error: unknown) => {
  console.error(`[trickle] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
