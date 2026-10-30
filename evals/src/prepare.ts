import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  AGENT_OUTPUT_LIMIT,
  agentApi,
  ASSISTANT_ID,
  ask,
  findDeployment,
  type Deployment,
} from "./agent.ts";
import { createApi } from "./api.ts";
import { developmentGap, parseGitHubRepo } from "./branches.ts";
import { readConfig, type Config } from "./config.ts";
import { seedDataset, type SeedExample } from "./dataset.ts";
import {
  assertionsRule,
  citesRule,
  ensureRule,
  resolveJudge,
  sharedRule,
  sharedTrajectoryRule,
  toneLlmRule,
  toneRule,
  trajectoryRule,
  type EnsureResult,
  type RuleTarget,
} from "./evaluators.ts";
import {
  EXPERIMENTS,
  removeStaleExperiments,
  runExperiment,
  waitForScores,
  type ExperimentResult,
} from "./experiments.ts";
import { tagAgentResources } from "./tags.ts";
import { sendTraffic } from "./traffic.ts";
import { ensureTriage } from "./triage.ts";

// Seeding always runs: every other step needs the dataset id, and it changes nothing when current.
const STEPS = ["readiness", "evaluators", "triage", "traffic", "experiments"] as const;
type Step = (typeof STEPS)[number];

const root = new URL("../", import.meta.url);

function log(line: string) {
  console.log(`[prepare] ${line}`);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, root), "utf8")) as T;
}

/** Wakes both deployments (`dev` deployments scale to zero) and fails fast if one is down. */
async function checkReadiness(config: Config, deployments: readonly Deployment[]) {
  await Promise.all(
    deployments.map((deployment) =>
      ask(agentApi(config, deployment), "Hi! What can you help with?", {
        metadata: { source: "demo-prepare-readiness" },
      }),
    ),
  );
}

function githubRepo(env: Record<string, string | undefined>): string | null {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  try {
    return parseGitHubRepo(
      execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }),
    );
  } catch {
    return null;
  }
}

/** Warns, without failing, when development has nothing main lacks: the candidate would rerun the baseline. */
async function checkBranches(env: Record<string, string | undefined>) {
  const repo = githubRepo(env);
  if (!repo) return log("branch check skipped: no GitHub origin remote");
  const gap = await developmentGap(repo, { token: env.GH_TOKEN ?? env.GITHUB_TOKEN });
  if (gap.kind === "ahead")
    return log(`branch check ok: development is ${gap.commits} commit(s) ahead of main`);
  if (gap.kind === "unknown") return log(`branch check skipped for ${repo}: ${gap.reason}`);
  log(
    `WARNING: development has no commits that main lacks in ${repo}, so the development-candidate experiment will match the baseline. Fork with every branch copied, or push upstream's development branch to your fork.`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      "skip-wait": { type: "boolean", default: false },
      concurrency: { type: "string", default: "4" },
      split: { type: "string" },
      roles: { type: "string" },
      refresh: { type: "boolean", default: false },
    },
  });
  const steps = new Set<Step>(
    values.only ? (values.only.split(",").map((step) => step.trim()) as Step[]) : STEPS,
  );
  const unknown = [...steps].filter((step) => !STEPS.includes(step));
  if (unknown.length > 0)
    throw new Error(`Unknown step(s): ${unknown.join(", ")}. Steps: ${STEPS.join(", ")}`);
  const concurrency = Number(values.concurrency);

  const config = readConfig(process.env);
  const api = createApi({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
    workspaceId: config.workspaceId,
  });
  const hostApi = createApi({
    baseUrl: config.hostUrl,
    apiKey: config.apiKey,
    workspaceId: config.workspaceId,
  });

  const [production, development] = await Promise.all([
    findDeployment(hostApi, "production"),
    findDeployment(hostApi, "development"),
  ]);
  const deployments = { production, development };
  log(
    `production revision ${production.revisionId}, development revision ${development.revisionId}`,
  );

  const seeds = await readJson<SeedExample[]>("dataset/examples.json");
  const manifest: Record<string, unknown> = {
    preparedAt: new Date().toISOString(),
    workspaceId: config.workspaceId,
    deployments,
  };

  if (steps.has("readiness")) {
    await checkReadiness(config, [production, development]);
    log("readiness ok: both deployments answered");
    await checkBranches(process.env);
  }

  const dataset = await seedDataset(api, seeds);
  log(
    `dataset ${dataset.id}: ${dataset.created} created, ${dataset.updated} updated, ${dataset.unchanged} unchanged; baseline ${dataset.baselineAsOf}`,
  );
  manifest.dataset = dataset;

  if (steps.has("evaluators")) {
    const judge = await resolveJudge(api);
    const code = await readFile(new URL("evaluators/cites-retrieved-docs.js", root), "utf8");
    const datasetTarget: RuleTarget = { kind: "dataset", datasetId: dataset.id };
    const tone = await ensureRule(api, datasetTarget, toneRule(dataset.id));
    const toneLlm = await ensureRule(api, datasetTarget, toneLlmRule(dataset.id));
    const cites = await ensureRule(api, datasetTarget, citesRule(dataset.id, code));
    const results: EnsureResult[] = [
      await ensureRule(api, datasetTarget, assertionsRule(dataset.id, judge)),
      tone,
      toneLlm,
      cites,
    ];
    for (const deployment of [production, development]) {
      const target: RuleTarget = { kind: "session", sessionId: deployment.tracerSessionId };
      for (const source of [tone, cites])
        results.push(await ensureRule(api, target, sharedRule(target, source)));
      // Off until someone turns it on: Jev already scores tone on every trace.
      results.push(await ensureRule(api, target, sharedRule(target, toneLlm, { enabled: false })));
    }
    const trajectory = await ensureRule(
      api,
      { kind: "session", sessionId: production.tracerSessionId },
      trajectoryRule(production.tracerSessionId, judge),
    );
    results.push(
      trajectory,
      await ensureRule(
        api,
        { kind: "session", sessionId: development.tracerSessionId },
        sharedTrajectoryRule(development.tracerSessionId, trajectory),
      ),
    );
    for (const result of results) log(`evaluator ${result.name}: ${result.status}`);
    manifest.evaluators = results;
  }

  if (steps.has("triage")) {
    manifest.triage = await ensureTriage(api, dataset.id, [
      production.tracerSessionId,
      development.tracerSessionId,
    ]);
    log("triage queue and rules ready");
  }

  const tagged = await tagAgentResources(api, dataset.id);
  log(
    tagged === null
      ? `agent tagging skipped: the workspace has no Agent tag for ${ASSISTANT_ID}`
      : `tagged ${tagged} resources to agent ${ASSISTANT_ID}`,
  );
  manifest.tagged = tagged;

  if (steps.has("traffic")) {
    const questions = await readJson<string[]>("dataset/traffic.json");
    const summary = await sendTraffic(agentApi(config, production), api, questions, {
      outputLimit: AGENT_OUTPUT_LIMIT,
      incompleteThumbsDown: 5,
      informalThumbsDown: 3,
      okThumbsUp: 0,
      concurrency,
    });
    log(`traffic: ${JSON.stringify(summary)}`);
    manifest.traffic = summary;
  }

  if (steps.has("experiments")) {
    const roles = values.roles?.split(",").map((role) => role.trim());
    const specs = roles ? EXPERIMENTS.filter((spec) => roles.includes(spec.role)) : EXPERIMENTS;
    if (specs.length === 0) throw new Error(`No experiments match --roles ${values.roles}`);
    const experiments: ExperimentResult[] = [];
    for (const spec of specs) {
      const deployment = deployments[spec.environment];
      experiments.push(
        await runExperiment({
          api,
          agentApi: agentApi(config, deployment),
          spec,
          deployment,
          datasetId: dataset.id,
          asOf: dataset.baselineAsOf,
          concurrency,
          split: values.split,
          fresh: values.refresh,
          log,
        }),
      );
    }
    manifest.experiments = experiments;
    if (!values["skip-wait"]) {
      const completion = await waitForScores({
        api,
        experiments,
        timeoutMs: 15 * 60_000,
        pollMs: 15_000,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: Date.now,
        log,
      });
      manifest.completion = completion;
      // Only a complete run replaces the experiments a DE might be comparing against.
      if (values.refresh) {
        for (const experiment of experiments) {
          if (!completion[experiment.role]?.complete) continue;
          const removed = await removeStaleExperiments(api, dataset.id, experiment);
          log(`${experiment.role}: removed ${removed} older experiment(s)`);
        }
      }
    }
  }

  await mkdir(new URL(".prepare/", root), { recursive: true });
  await writeFile(
    new URL(".prepare/manifest.json", root),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  log("manifest written to evals/.prepare/manifest.json");
}

main().catch((error: unknown) => {
  console.error(`[prepare] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
