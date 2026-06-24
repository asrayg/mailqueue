import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");

/** Persist an uploaded file and return its absolute path. */
export function saveUpload(
  campaignSlug: string,
  filename: string,
  data: Buffer
): string {
  const dir = path.join(UPLOADS_DIR, campaignSlug);
  mkdirSync(dir, { recursive: true });
  // Avoid path traversal from the original filename.
  const safeName = path.basename(filename).replace(/[^\w.\-]+/g, "_");
  const dest = path.join(dir, safeName);
  writeFileSync(dest, data);
  return dest;
}
