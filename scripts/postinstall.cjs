// Best-effort: link the `mailqueue` CLI globally after a local `npm install`,
// so `mailqueue ...` works anywhere (in addition to `npm run mq -- ...`).
//
// Guards against the recursion that would happen when `npm link` itself runs
// the install lifecycle in the global context (npm_config_global === "true"),
// and stays out of CI / opt-out environments. Never fails the install.
"use strict";
const { execSync } = require("node:child_process");

if (
  process.env.npm_config_global === "true" ||
  process.env.CI ||
  process.env.MQ_NO_LINK
) {
  process.exit(0);
}

try {
  execSync("npm link", { stdio: "ignore" });
  console.log(
    "✓ mailqueue CLI linked globally — run `mailqueue --help` (or `npm run mq -- --help`)."
  );
} catch {
  console.log(
    "mailqueue: optional — run `npm link` to enable the global `mailqueue` command (set MQ_NO_LINK=1 to silence)."
  );
}
