#!/usr/bin/env node
// Thin launcher: run the TypeScript CLI through tsx without a build step.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "..", "cli", "index.ts");

const res = spawnSync(
  process.execPath,
  [path.resolve(here, "..", "node_modules", "tsx", "dist", "cli.mjs"), cli, ...process.argv.slice(2)],
  { stdio: "inherit" }
);
process.exit(res.status ?? 1);
