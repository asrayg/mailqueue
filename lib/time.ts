import { formatInTimeZone, toZonedTime } from "date-fns-tz";

/** Returns minutes-since-midnight for a "HH:mm" string. */
function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

export interface SendingWindow {
  start: string; // "HH:mm"
  end: string; // "HH:mm"
  timezone: string;
  days: number[]; // 0=Sun..6=Sat
}

/** Is `now` within the campaign's sending window (day + time, in its tz)? */
export function insideSendingWindow(window: SendingWindow, now: Date): boolean {
  const zoned = toZonedTime(now, window.timezone);
  const day = zoned.getDay();
  if (!window.days.includes(day)) return false;

  const minutesNow = zoned.getHours() * 60 + zoned.getMinutes();
  const startMin = parseHHmm(window.start);
  const endMin = parseHHmm(window.end);
  return minutesNow >= startMin && minutesNow < endMin;
}

/** Random integer delay in seconds, inclusive. */
export function getRandomDelay(minSeconds: number, maxSeconds: number): number {
  return (
    Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds
  );
}

export function formatLocal(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd HH:mm zzz");
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "8:23 PM" — 12-hour clock, used by provider schedule-send time inputs. */
export function format12hTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "24 Jun" — matches Gmail's schedule-picker calendar gridcell accessible names. */
export function dayMonthCell(d: Date): string {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * Rough estimate of completion: remaining recipients / per-day cap, accounting
 * for average delay. Returns an estimated finish Date (best-effort, naive).
 */
export function estimateCompletion(
  remaining: number,
  maxPerDay: number,
  now: Date
): Date {
  if (remaining <= 0) return now;
  const fullDays = Math.floor(remaining / maxPerDay);
  const finish = new Date(now);
  finish.setDate(finish.getDate() + fullDays);
  return finish;
}
