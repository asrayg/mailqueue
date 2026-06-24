import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/** Stable SHA-256 of a string (used for body content). */
export function hashString(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Hash a set of attachment files by content. Returns a single combined hash
 * representing the ordered set. Empty list returns a sentinel hash.
 */
export function hashFiles(filePaths: string[]): string {
  if (filePaths.length === 0) return hashString("no-attachments");
  const hash = createHash("sha256");
  for (const p of [...filePaths].sort()) {
    const data = readFileSync(p);
    hash.update(p);
    hash.update(data);
  }
  return hash.digest("hex");
}

export interface FileCheckResult {
  path: string;
  exists: boolean;
  sizeBytes: number;
  tooLarge: boolean;
}

// Most providers reject attachments above ~25MB.
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function checkFiles(filePaths: string[]): FileCheckResult[] {
  return filePaths.map((p) => {
    try {
      const st = statSync(p);
      return {
        path: p,
        exists: true,
        sizeBytes: st.size,
        tooLarge: st.size > MAX_ATTACHMENT_BYTES,
      };
    } catch {
      return { path: p, exists: false, sizeBytes: 0, tooLarge: false };
    }
  });
}
