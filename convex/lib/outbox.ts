import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { eventForStatus } from "./loanState";
import type { LoanStatus, WebhookEvent } from "./validators";

export const MAX_DELIVERY_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/** Exponential backoff with full jitter: 30s, 60s, 120s, ... capped at 1h. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/** Who should hear about each status change. */
function recipientRole(status: LoanStatus): "owner" | "borrower" {
  return status === "requested" || status === "cancelled" ? "owner" : "borrower";
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * Data-minimized payload: just enough to write one notification email.
 * No descriptions, no counter-party contact details, no internal user IDs.
 */
export type WebhookPayload = {
  event: WebhookEvent;
  deliveryKey: string;
  loanId: string;
  toolName: string;
  status: LoanStatus;
  recipient: { email: string; firstName: string };
  startDate: string;
  endDate: string;
};

/**
 * Writes an outbox row in the caller's transaction and schedules delivery.
 * If the mutation rolls back, neither the loan change nor the webhook happens.
 */
export async function enqueueLoanEvent(ctx: MutationCtx, loan: Doc<"loans">): Promise<void> {
  const [tool, recipient] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(recipientRole(loan.status) === "owner" ? loan.ownerId : loan.borrowerId),
  ]);
  if (!tool || !recipient) return;

  const event = eventForStatus(loan.status);
  const payload: WebhookPayload = {
    event,
    // Stable per (loan, status) so n8n / write-back can dedupe retries.
    deliveryKey: `${loan._id}:${loan.status}`,
    loanId: loan._id,
    toolName: tool.name,
    status: loan.status,
    recipient: { email: recipient.email, firstName: firstName(recipient.name) },
    startDate: loan.startDate,
    endDate: loan.endDate,
  };

  const now = Date.now();
  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    loanId: loan._id,
    event,
    payload: JSON.stringify(payload),
    attempts: 0,
    status: "pending",
    nextAttemptAt: now,
    createdAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
}
