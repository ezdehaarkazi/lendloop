import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { todayUtc } from "./lib/dates";
import { enqueueLoanEvent } from "./lib/outbox";

export const listTools = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const tools = (await ctx.db.query("tools").order("desc").take(500)).filter(
      (t) => t.deletedAt === undefined,
    );
    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          ownerName: owner?.name ?? "Unknown",
          ownerTrusted: owner?.trustedLender ?? false,
          createdAt: t.createdAt,
        };
      }),
    );
  },
});

/**
 * Admin removes any listing. Pending requests on it are declined (and the
 * borrowers notified); approved loans stay so the return can still be tracked.
 */
export const removeTool = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    await requireAdmin(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt !== undefined) throw new ConvexError("Tool not found.");
    const now = Date.now();
    await ctx.db.patch(toolId, { deletedAt: now });

    const pending = (
      await ctx.db
        .query("loans")
        .withIndex("by_tool", (q) => q.eq("toolId", toolId))
        .collect()
    ).filter((l) => l.status === "requested");
    for (const loan of pending) {
      await ctx.db.patch(loan._id, { status: "declined", updatedAt: now });
      await enqueueLoanEvent(ctx, { ...loan, status: "declined", updatedAt: now });
    }
  },
});

export const listLoans = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const today = todayUtc();
    const loans = await ctx.db.query("loans").order("desc").take(500);
    return await Promise.all(
      loans.map(async (l) => {
        const [tool, borrower, owner] = await Promise.all([
          ctx.db.get(l.toolId),
          ctx.db.get(l.borrowerId),
          ctx.db.get(l.ownerId),
        ]);
        return {
          _id: l._id,
          toolName: tool?.name ?? "Unknown",
          borrowerName: borrower?.name ?? "Unknown",
          ownerName: owner?.name ?? "Unknown",
          startDate: l.startDate,
          endDate: l.endDate,
          status: l.status,
          overdue: l.status === "approved" && l.endDate < today,
        };
      }),
    );
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(500);
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/** Outbox + n8n health: failed/pending deliveries and workflow errors. */
export const automationHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [failed, pending, errors] = await Promise.all([
      ctx.db
        .query("webhookDeliveries")
        .withIndex("by_status", (q) => q.eq("status", "failed"))
        .order("desc")
        .take(50),
      ctx.db
        .query("webhookDeliveries")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .order("desc")
        .take(50),
      ctx.db.query("automationErrors").withIndex("by_createdAt").order("desc").take(20),
    ]);
    const shape = (d: (typeof failed)[number]) => ({
      _id: d._id,
      event: d.event,
      attempts: d.attempts,
      lastError: d.lastError,
      status: d.status,
      createdAt: d.createdAt,
      nextAttemptAt: d.nextAttemptAt,
    });
    return {
      failed: failed.map(shape),
      pending: pending.map(shape),
      errors: errors.map((e) => ({
        _id: e._id,
        workflow: e.workflow,
        node: e.node,
        message: e.message,
        createdAt: e.createdAt,
      })),
    };
  },
});

/** Manually re-drive a dead-lettered delivery. */
export const retryDelivery = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    await requireAdmin(ctx);
    const d = await ctx.db.get(deliveryId);
    if (!d || d.status !== "failed") throw new ConvexError("Only failed deliveries can be retried.");
    await ctx.db.patch(deliveryId, { status: "pending", attempts: 0, nextAttemptAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
  },
});
