import { ConvexError } from "convex/values";
import { LIMITS } from "./validators";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Today's calendar day in UTC as YYYY-MM-DD. */
export function todayUtc(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function parseDay(day: string): number {
  if (!ISO_DAY.test(day)) throw new ConvexError(`Invalid date "${day}".`);
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day) {
    throw new ConvexError(`Invalid date "${day}".`);
  }
  return ms;
}

/** Inclusive number of days in [start, end]. */
export function daysInclusive(start: string, end: string): number {
  return Math.round((parseDay(end) - parseDay(start)) / DAY_MS) + 1;
}

export function validateLoanRange(start: string, end: string, today: string): void {
  parseDay(start);
  parseDay(end);
  if (start < today) throw new ConvexError("Start date cannot be in the past.");
  if (end < start) throw new ConvexError("End date must be on or after the start date.");
  if (daysInclusive(start, end) > LIMITS.maxLoanDays) {
    throw new ConvexError(`Loans can be at most ${LIMITS.maxLoanDays} days.`);
  }
}

/** Inclusive ranges overlap if each starts before the other ends. */
export function rangesOverlap(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
