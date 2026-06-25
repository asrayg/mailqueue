#!/usr/bin/env node
// Thin launcher: run the TypeScript CLI through tsx without a build step.
// CommonJS so it runs regardless of Node version or package "type".
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const here = __dirname;
const cli = path.resolve(here, "..", "cli", "index.ts");
const tsx = path.resolve(here, "..", "node_modules", "tsx", "dist", "cli.mjs");

const res = spawnSync(process.execPath, [tsx, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
