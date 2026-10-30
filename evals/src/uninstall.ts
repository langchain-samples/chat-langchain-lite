import { parseArgs } from "node:util";

import { ASSISTANT_ID } from "./agent.ts";
import { ApiError, createApi, type Api } from "./api.ts";
import { readConfig } from "./config.ts";
import { checklist, originRepo } from "./github.ts";
import {
  deletionPlan,
  discoverInventory,
  isEmpty,
  KNOWN_LEFTOVERS,
  renderInventory,
  type PlannedRemoval,
} from "./inventory.ts";

const log = (message: string) => console.log(`[uninstall] ${message}`);

type Outcome = "deleted" | "already gone" | "failed";

async function remove(apis: Record<"smith" | "host", Api>, step: PlannedRemoval): Promise<Outcome> {
  const { api, path, query } = step.removal;
  try {
    await apis[api].delete(path, query);
    return "deleted";
  } catch (error) {
    // The agent delete removes its tracing projects in the background, so a later delete can find one mid-deletion.
    if (error instanceof ApiError && (error.status === 404 || /being deleted/i.test(error.body)))
      return "already gone";
    log(`  ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }
}

async function main() {
  const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });
  const config = readConfig(process.env);
  const client = (baseUrl: string) =>
    createApi({ baseUrl, apiKey: config.apiKey, workspaceId: config.workspaceId });
  const apis = { smith: client(config.apiUrl), host: client(config.hostUrl) };

  const inventory = await discoverInventory(apis.smith, apis.host);
  log(`${ASSISTANT_ID} resources in workspace ${config.workspaceId}:${renderInventory(inventory)}`);
  if (isEmpty(inventory)) log("nothing to delete.");
  else if (!values.yes) {
    log(
      "dry run: nothing deleted. Re-run with --yes to delete everything above, in dependency order.",
    );
  } else {
    let failed = 0;
    for (const step of deletionPlan(inventory)) {
      const outcome = await remove(apis, step);
      if (outcome === "failed") failed += 1;
      log(`${outcome}: ${step.section} ${step.item.name}`);
    }
    const left = await discoverInventory(apis.smith, apis.host);
    if (isEmpty(left)) log("verified: nothing left.");
    else {
      log(
        `still present (deletes can finish in the background; re-run to retry):${renderInventory(left)}`,
      );
      process.exitCode = 1;
    }
    if (failed > 0) process.exitCode = 1;
  }

  log(`Known leftovers:\n${KNOWN_LEFTOVERS.map((line) => `  - ${line}`).join("\n")}`);
  log(
    `Kept on purpose: the LC_GATEWAY_KEY workspace secret and the user_score feedback config, which other apps share.`,
  );
  let repo = "your fork";
  try {
    repo = originRepo();
  } catch {}
  log(
    `Remove by hand:\n${checklist(repo)
      .map((line) => `  ${line}`)
      .join("\n")}`,
  );
}

main().catch((error: unknown) => {
  console.error(`[uninstall] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
