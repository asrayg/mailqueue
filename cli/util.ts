import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { PROVIDERS, type Provider } from "../lib/validation";

/** Load .env (DATABASE_URL etc.) without a dependency. Call once at startup. */
export function loadEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    /* rely on the real environment */
  }
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
