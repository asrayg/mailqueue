import { z } from "zod";

// Pragmatic email regex — good enough to catch obvious garbage rows.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const PROVIDERS = ["gmail", "outlook", "zoho"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const campaignFormSchema = z.object({
  name: z.string().min(1, "Campaign name is required").max(120),
  provider: z.enum(PROVIDERS),
  subjectTemplate: z.string().min(1, "Subject is required").max(998),
  bodyTemplate: z.string().min(1, "Body is required"),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  attachmentPaths: z.array(z.string()).default([]),
  sendingWindowStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:mm")
    .default("09:00"),
  sendingWindowEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:mm")
    .default("16:30"),
  timezone: z.string().default("America/Chicago"),
  sendDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  maxPerHour: z.number().int().positive().max(200).default(10),
  maxPerDay: z.number().int().positive().max(1000).default(50),
  minDelaySeconds: z.number().int().min(30).default(180),
  maxDelaySeconds: z.number().int().min(30).default(900),
  recontactAfterDays: z
    .union([z.literal(30), z.literal(60), z.literal(90), z.null()])
    .default(30),
});

export type CampaignFormInput = z.input<typeof campaignFormSchema>;
export type CampaignFormValues = z.output<typeof campaignFormSchema>;

/** Validate delay range coherence. Returns an error string or null. */
export function validateDelayRange(min: number, max: number): string | null {
  if (max < min) return "Maximum delay must be >= minimum delay";
  return null;
}
