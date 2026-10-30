// Creates agent/.env from the template and fills the Gateway key from MDM, without printing secrets.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const envPath = "agent/.env";

if (!existsSync(envPath)) {
  copyFileSync("agent/.env.example", envPath);
  console.log(`Created ${envPath}.`);
}

const lines = readFileSync(envPath, "utf8").trimEnd().split("\n");
const valueOf = (key) => lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1) ?? "";

const readLaunchctl = (name) => {
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync("launchctl", ["getenv", name], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

if (!valueOf("LANGSMITH_GATEWAY_API_KEY")) {
  const gatewayKey = readLaunchctl("LC_GATEWAY_KEY");
  if (gatewayKey) {
    const updated = lines.filter((line) => !line.startsWith("LANGSMITH_GATEWAY_API_KEY="));
    updated.push(`LANGSMITH_GATEWAY_API_KEY=${gatewayKey}`);
    writeFileSync(envPath, `${updated.join("\n")}\n`);
    console.log("Filled LANGSMITH_GATEWAY_API_KEY from LC_GATEWAY_KEY.");
  } else {
    console.warn("LANGSMITH_GATEWAY_API_KEY is blank and LC_GATEWAY_KEY was not found. Paste it into agent/.env.");
  }
}

if (!valueOf("LANGSMITH_API_KEY")) {
  console.warn("LANGSMITH_API_KEY is blank. Paste your LangSmith personal access token into agent/.env.");
}

if (!process.env.LANGSMITH_WORKSPACE_ID) {
  console.warn(
    'LANGSMITH_WORKSPACE_ID is not set. Add it to mise.local.toml:\n  [env]\n  LANGSMITH_WORKSPACE_ID = "<your workspace id>"',
  );
}
