// mda copies agent/ into its build: a lockfile there makes LangSmith's builder use the wrong package manager,
// and workspace:/catalog: specs can't be resolved by its npm install.
import { existsSync, readFileSync } from "node:fs";

const problems = [];
for (const lockfile of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"]) {
  if (existsSync(`agent/${lockfile}`)) problems.push(`agent/${lockfile} must not exist`);
}

const manifest = JSON.parse(readFileSync("agent/package.json", "utf8"));
for (const section of ["dependencies", "devDependencies"]) {
  for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
    if (/^(workspace|catalog):/.test(spec)) problems.push(`agent/package.json ${section}.${name} uses "${spec}"`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
