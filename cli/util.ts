import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { PROVIDERS, type Provider } from "../lib/validation";

/** The MailQueue project root (this file lives at <root>/cli/util.ts). */
export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Load env + resolve all paths against the project root so the CLI works from
 * ANY working directory (e.g. when installed globally via `npm link`). SQLite,
 * browser profiles, and uploads all live inside the project regardless of CWD.
 * Call once at startup, before any DB query.
 */
export function loadEnv(): void {
  // Prefer the project's .env; also try CWD .env as a fallback.
  for (const p of [path.join(PROJECT_ROOT, ".env"), undefined] as const) {
    try {
      p ? process.loadEnvFile(p) : process.loadEnvFile();
    } catch {
      /* file may not exist — rely on the real environment */
    }
  }

  // DATABASE_URL: resolve a relative sqlite path against <root>/prisma (Prisma
  // resolves "file:./dev.db" relative to the schema dir).
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("file:") && !url.startsWith("file:/")) {
    process.env.DATABASE_URL = "file:" + path.resolve(PROJECT_ROOT, "prisma", url.slice(5));
  } else if (!url) {
    process.env.DATABASE_URL = "file:" + path.resolve(PROJECT_ROOT, "prisma", "dev.db");
  }

  // Browser profiles + uploads live in the project, not the CWD.
  process.env.BROWSER_PROFILES_DIR = path.resolve(
    PROJECT_ROOT,
    process.env.BROWSER_PROFILES_DIR || "browser-profiles"
  );
  process.env.UPLOADS_DIR = path.resolve(PROJECT_ROOT, process.env.UPLOADS_DIR || "uploads");
}

let jsonMode = false;
export function setJsonMode(on: boolean): void {
  jsonMode = on;
}
export function isJson(): boolean {
  return jsonMode;
}

/**
 * Emit a result. In --json mode prints JSON to stdout; otherwise calls the
 * human formatter. Always use this so output is consistent and parseable.
 */
export function emit(data: unknown, human: (d: any) => void): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    human(data);
  }
}

/** Print an error in the active format and exit non-zero. */
export function fail(message: string, code = 1): never {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(code);
}

export function parseProvider(value: string): Provider {
  const v = value.toLowerCase().trim();
  if (!(PROVIDERS as readonly string[]).includes(v)) {
    fail(`Invalid provider "${value}". Use one of: ${PROVIDERS.join(", ")}`);
  }
  return v as Provider;
}

/** Resolve attachment paths to absolute, verifying each exists. */
export function resolveAttachments(paths: string[] = []): string[] {
  return paths.map((p) => {
    const abs = path.resolve(p);
    if (!existsSync(abs)) fail(`Attachment not found: ${p}`);
    return abs;
  });
}

/** Read an email body from --body or --body-file. */
export function readBody(opts: { body?: string; bodyFile?: string }): string {
  if (opts.bodyFile) {
    const abs = path.resolve(opts.bodyFile);
    if (!existsSync(abs)) fail(`Body file not found: ${opts.bodyFile}`);
    return readFileSync(abs, "utf8");
  }
  if (opts.body !== undefined) return opts.body;
  fail("Provide --body or --body-file");
}

const DAY_KEYWORDS: Record<string, number[]> = {
  weekdays: [1, 2, 3, 4, 5],
  "mon-fri": [1, 2, 3, 4, 5],
  "mon-sat": [1, 2, 3, 4, 5, 6],
  all: [0, 1, 2, 3, 4, 5, 6],
  everyday: [0, 1, 2, 3, 4, 5, 6],
};

/** "weekdays" | "mon-fri" | "all" | "1,2,3,4,5" -> number[] (0=Sun..6=Sat). */
export function parseDays(value?: string): number[] {
  if (!value) return [1, 2, 3, 4, 5];
  const key = value.toLowerCase().trim();
  if (DAY_KEYWORDS[key]) return DAY_KEYWORDS[key];
  const nums = key
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (nums.length === 0) fail(`Invalid --days "${value}"`);
  return nums;
}

/** "09:00-16:30" -> { start, end }. */
export function parseWindow(value?: string): { start: string; end: string } {
  if (!value) return { start: "09:00", end: "16:30" };
  const m = value.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) fail(`Invalid --window "${value}". Use HH:MM-HH:MM`);
  return { start: m![1], end: m![2] };
}

/** "180-900" -> { min, max } seconds. */
export function parseDelay(value?: string): { min: number; max: number } {
  if (!value) return { min: 180, max: 900 };
  const m = value.match(/^(\d+)-(\d+)$/);
  if (!m) fail(`Invalid --delay "${value}". Use MIN-MAX (seconds)`);
  return { min: parseInt(m![1], 10), max: parseInt(m![2], 10) };
}

/** "30" | "60" | "90" | "never" -> number | null. */
export function parseRecontact(value?: string): number | null {
  if (!value || value.toLowerCase() === "never") return null;
  const n = parseInt(value, 10);
  if (![30, 60, 90].includes(n)) fail(`Invalid --recontact "${value}". Use 30|60|90|never`);
  return n;
}

/** "+10m" | "10" (minutes) | ISO date -> Date in the future. */
export function parseScheduleAt(value?: string): Date | undefined {
  if (!value) return undefined;
  const rel = value.match(/^\+?(\d+)m?$/);
  if (rel) return new Date(Date.now() + parseInt(rel[1], 10) * 60_000);
  const d = new Date(value);
  if (isNaN(d.getTime())) fail(`Invalid --in/--at "${value}". Use minutes (e.g. 10) or an ISO datetime`);
  return d;
}
