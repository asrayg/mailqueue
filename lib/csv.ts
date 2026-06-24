import Papa from "papaparse";
import { isValidEmail, normalizeEmail } from "./validation";

export interface ParsedRecipient {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  metadata: Record<string, string>;
}

export interface CsvParseResult {
  valid: ParsedRecipient[];
  duplicateRows: number;
  invalidRows: number;
  invalidSamples: string[]; // up to a few bad email strings, for the UI
  totalRows: number;
}

// CSV header aliases mapped to canonical recipient fields.
const FIELD_ALIASES: Record<string, "email" | "firstName" | "lastName" | "company"> = {
  email: "email",
  "e-mail": "email",
  first_name: "firstName",
  firstname: "firstName",
  "first name": "firstName",
  last_name: "lastName",
  lastname: "lastName",
  "last name": "lastName",
  company: "company",
  organization: "company",
  org: "company",
};

/**
 * Parse a CSV string into validated, de-duplicated recipients.
 * - trims + lowercases emails
 * - drops invalid emails
 * - drops duplicate emails (first occurrence wins)
 */
export function parseRecipientsCsv(csv: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const rows = parsed.data ?? [];
  const seen = new Set<string>();
  const valid: ParsedRecipient[] = [];
  const invalidSamples: string[] = [];
  let duplicateRows = 0;
  let invalidRows = 0;

  for (const row of rows) {
    const record: Record<string, string> = {};
    let email = "";
    const metadata: Record<string, string> = {};
    let firstName: string | undefined;
    let lastName: string | undefined;
    let company: string | undefined;

    for (const [rawKey, rawVal] of Object.entries(row)) {
      const key = rawKey.trim().toLowerCase();
      const val = (rawVal ?? "").toString().trim();
      record[key] = val;
      const canonical = FIELD_ALIASES[key];
      if (canonical === "email") email = normalizeEmail(val);
      else if (canonical === "firstName") firstName = val || undefined;
      else if (canonical === "lastName") lastName = val || undefined;
      else if (canonical === "company") company = val || undefined;
      else if (val) metadata[key] = val;
    }

    if (!email || !isValidEmail(email)) {
      invalidRows++;
      if (email && invalidSamples.length < 5) invalidSamples.push(email);
      else if (!email && invalidSamples.length < 5) invalidSamples.push("(blank)");
      continue;
    }
    if (seen.has(email)) {
      duplicateRows++;
      continue;
    }
    seen.add(email);
    valid.push({ email, firstName, lastName, company, metadata });
  }

  return {
    valid,
    duplicateRows,
    invalidRows,
    invalidSamples,
    totalRows: rows.length,
  };
}
