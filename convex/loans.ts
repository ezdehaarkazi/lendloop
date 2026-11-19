import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireLoanParty, requireUser } from "./lib/auth";
import { rangesOverlap, todayUtc, validateLoanRange } from "./lib/dates";
import { assertTransition } from "./lib/loanState";
import { enqueueLoanEvent } from "./lib/outbox";
import type { LoanStatus } from "./lib/validators";

async function approvedLoansFor(ctx: QueryCtx, toolId: Id<"tools">) {
  return (
    await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect()
  ).filter((l) => l.status === "approved");
}

/** Applies a validated status change and writes the outbox event atomically. */
async function transition(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  to: LoanStatus,
): Promise<void> {
  assertTransition(loan.status, to);
  const now = Date.now();
  const patch: Partial<Doc<"loans">> = { status: to, updatedAt: now };
  if (to === "returned") patch.returnedAt = now;
  await ctx.db.patch(loan._id, patch);
  await enqueueLoanEvent(ctx, { ...loan, ...patch });
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt !== undefined) throw new ConvexError("Tool not found.");
    if (tool.ownerId === user._id) throw new ConvexError("You can't borrow your own tool.");

    validateLoanRange(startDate, endDate, todayUtc());
    const range = { startDate, endDate };

    const all = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    if (all.some((l) => l.status === "approved" && rangesOverlap(l, range))) {
      throw new ConvexError("Those dates overlap an existing loan.");
    }
    if (
      all.some(
        (l) => l.borrowerId === user._id && l.status === "requested" && rangesOverlap(l, range),
      )
    ) {
      throw new ConvexError("You already have a pending request for these dates.");
    }

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId,
      borrowerId: user._id,
      ownerId: tool.ownerId,
      startDate,
      endDate,
      status: "requested",
      createdAt: now,
      updatedAt: now,
    });
    const loan = await ctx.db.get(loanId);
    if (loan) await enqueueLoanEvent(ctx, loan);
    return loanId;
  },
});

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanParty(ctx, loanId, "owner");
    assertTransition(loan.status, "approved");
    if (loan.endDate < todayUtc()) {
      throw new ConvexError("These dates have already passed — decline instead.");
    }
    // Re-check at approval time: another request may have been approved since.
    const approved = await approvedLoansFor(ctx, loan.toolId);
    if (approved.some((l) => rangesOverlap(l, loan))) {
      throw new ConvexError("This overlaps a loan you already approved.");
    }
    await transition(ctx, loan, "approved");
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanParty(ctx, loanId, "owner");
    await transition(ctx, loan, "declined");
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanParty(ctx, loanId, "owner");
    await transition(ctx, loan, "returned");
  },
});

export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanParty(ctx, loanId, "borrower");
    await transition(ctx, loan, "cancelled");
  },
});

/** Shapes a loan for the UI, exposing only the counter-party's display name. */
async function toLoanView(ctx: QueryCtx, loan: Doc<"loans">, viewer: "owner" | "borrower") {
  const today = todayUtc();
  const [tool, other] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(viewer === "owner" ? loan.borrowerId : loan.ownerId),
  ]);
  return {
    _id: loan._id,
    toolId: loan.toolId,
    toolName: tool?.name ?? "Removed tool",
    toolRemoved: !tool || tool.deletedAt !== undefined,
    otherPartyName: other?.name ?? "Neighbor",
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < today,
    createdAt: loan.createdAt,
    returnedAt: loan.returnedAt,
  };
}

export type LoanView = Awaited<ReturnType<typeof toLoanView>>;

/** My borrow requests (as borrower). */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((l) => toLoanView(ctx, l, "borrower")));
  },
});

/** Requests and loans on my tools (as owner). */
export const listIncoming = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((l) => toLoanView(ctx, l, "owner")));
  },
});
