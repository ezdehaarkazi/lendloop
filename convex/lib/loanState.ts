import { ConvexError } from "convex/values";
import type { LoanStatus, WebhookEvent } from "./validators";

/** Allowed transitions. Anything not listed here is rejected. */
const TRANSITIONS: Record<LoanStatus, readonly LoanStatus[]> = {
  requested: ["approved", "declined", "cancelled"],
  approved: ["returned"],
  declined: [],
  returned: [],
  cancelled: [],
};

export function canTransition(from: LoanStatus, to: LoanStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: LoanStatus, to: LoanStatus): void {
  if (!canTransition(from, to)) {
    throw new ConvexError(`Cannot change a loan from "${from}" to "${to}".`);
  }
}

export function isTerminal(status: LoanStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function eventForStatus(status: LoanStatus): WebhookEvent {
  return `loan.${status}`;
}

/** Statuses that occupy the tool's calendar. */
export const BLOCKING_STATUSES: readonly LoanStatus[] = ["approved"];
