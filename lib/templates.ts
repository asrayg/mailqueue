// Simple {{variable}} template rendering for subject + body.

export interface RecipientVars {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  [key: string]: string | undefined;
}

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export interface RenderResult {
  text: string;
  missingVars: string[];
}

/**
 * Render a template against recipient vars. Missing variables are replaced with
 * an empty string but reported in `missingVars` so the UI can warn before send.
 */
export function render(template: string, vars: RecipientVars): RenderResult {
  const missing = new Set<string>();
  const text = template.replace(VAR_RE, (_m, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null || value === "") {
      missing.add(key);
      return "";
    }
    return value;
  });
  return { text, missingVars: [...missing] };
}

/** List all distinct variable names referenced by a template. */
export function extractVars(template: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(template)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

/** Build the variable bag for a recipient, merging known fields + CSV metadata. */
export function buildVars(recipient: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  metadataJson?: string | null;
}): RecipientVars {
  let meta: Record<string, string> = {};
  if (recipient.metadataJson) {
    try {
      meta = JSON.parse(recipient.metadataJson);
    } catch {
      meta = {};
    }
  }
  return {
    ...meta,
    email: recipient.email,
    first_name: recipient.firstName ?? meta.first_name,
    last_name: recipient.lastName ?? meta.last_name,
    company: recipient.company ?? meta.company,
  };
}
