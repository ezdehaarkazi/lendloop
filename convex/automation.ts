import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { daysInclusive } from "./lib/dates";
import { vAutomationStatus, vAutomationType } from "./lib/validators";

/**
 * Approved loans whose end date is before `today` and that haven't been
 * returned. Minimized: only what a reminder email needs.
 */
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(500);
    const rows = await Promise.all(
      loans.map(async (loan) => {
        const idempotencyKey = `${loan._id}:${today}`;
        // Already reminded today → skip, so re-running the workflow never double-sends.
        const done = await ctx.db
          .query("automationEvents")
          .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
          .unique();
        if (done?.status === "sent") return null;

        const [tool, borrower] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.borrowerId),
        ]);
        if (!borrower) return null;
        return {
          loanId: loan._id,
          toolName: tool?.name ?? "a borrowed tool",
          endDate: loan.endDate,
          daysOverdue: daysInclusive(loan.endDate, today) - 1,
          borrower: {
            email: borrower.email,
            firstName: borrower.name.trim().split(/\s+/)[0] ?? "",
          },
          idempotencyKey,
        };
      }),
    );
    return rows.filter((r) => r !== null);
  },
});

/**
 * Idempotent write-back from n8n. The idempotencyKey has a unique index
 * (enforced here — Convex has no unique constraints — inside one serializable
 * transaction, so two concurrent calls cannot both insert).
 */
export const recordEvent = internalMutation({
  args: {
    loanId: v.string(),
    type: vAutomationType,
    idempotencyKey: v.string(),
    status: vAutomationStatus,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId || !(await ctx.db.get(loanId))) throw new ConvexError("Unknown loan.");
    // The key must belong to this loan, so a caller can't burn another loan's key.
    if (!args.idempotencyKey.startsWith(`${loanId}:`)) {
      throw new ConvexError("idempotencyKey does not match loanId.");
    }

    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    if (existing) {
      // A later success may supersede an earlier failure; nothing else changes.
      if (existing.status === "failed" && args.status === "sent") {
        await ctx.db.patch(existing._id, { status: "sent", error: undefined });
      }
      return { duplicate: true, id: existing._id };
    }

    const id = await ctx.db.insert("automationEvents", {
      loanId,
      type: args.type,
      idempotencyKey: args.idempotencyKey,
      status: args.status,
      error: args.error?.slice(0, 500),
      createdAt: Date.now(),
    });
    return { duplicate: false, id };
  },
});

export const recordWorkflowError = internalMutation({
  args: {
    workflow: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    executionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("automationErrors", {
      workflow: args.workflow.slice(0, 120),
      node: args.node?.slice(0, 120),
      message: args.message.slice(0, 1000),
      executionId: args.executionId?.slice(0, 64),
      createdAt: Date.now(),
    });
  },
});
