import type { Environment } from "./agent.ts";
import { createApi } from "./api.ts";
import { readConfig } from "./config.ts";
import {
  findAgentDeployment,
  GATEWAY_KEY_SECRET,
  mergeSecrets,
  waitUntilDeployed,
  type DeploymentRecord,
} from "./deployments.ts";

const log = (message: string) => console.log(`[gateway-key] ${message}`);
const ENVIRONMENTS: readonly Environment[] = ["development", "production"];

async function main() {
  const gatewayKey = process.env[GATEWAY_KEY_SECRET]?.trim();
  if (!gatewayKey)
    throw new Error(
      `${GATEWAY_KEY_SECRET} is blank. Add it as a repo secret, or to agent/.env for a local run.`,
    );
  const config = readConfig(process.env);
  const hostApi = createApi({
    baseUrl: config.hostUrl,
    apiKey: config.apiKey,
    workspaceId: config.workspaceId,
  });

  for (const environment of ENVIRONMENTS) {
    const record = await findAgentDeployment(hostApi, environment);
    if (!record) throw new Error(`${environment} isn't deployed. Run mise run demo:install`);
    // The list endpoint omits secrets.
    const current = await hostApi.get<DeploymentRecord>(`/v2/deployments/${record.id}`);
    const secrets = mergeSecrets(current.secrets ?? [], [
      { name: GATEWAY_KEY_SECRET, value: gatewayKey },
    ]);
    if (!secrets) {
      log(`${environment}: ${record.name} already has this key`);
      continue;
    }
    await hostApi.patch(`/v2/deployments/${record.id}`, { secrets });
    log(`${environment}: updated ${record.name}'s key, which rebuilds it`);
    await waitUntilDeployed(hostApi, record.id, log);
  }
}

main().catch((error: unknown) => {
  console.error(`[gateway-key] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
