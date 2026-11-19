import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireToolOwner, requireUser } from "./lib/auth";
import { todayUtc } from "./lib/dates";
import { LIMITS, vCategory, vCondition } from "./lib/validators";

function cleanToolInput(input: { name: string; description: string }) {
  const name = input.name.trim();
  const description = input.description.trim();
  if (name.length < 2 || name.length > LIMITS.toolNameMax) {
    throw new ConvexError(`Name must be 2–${LIMITS.toolNameMax} characters.`);
  }
  if (description.length > LIMITS.descriptionMax) {
    throw new ConvexError(`Description must be at most ${LIMITS.descriptionMax} characters.`);
  }
  return { name, description };
}

async function activeTools(ctx: QueryCtx, category?: Doc<"tools">["category"]) {
  const rows = category
    ? await ctx.db
        .query("tools")
        .withIndex("by_category", (q) => q.eq("category", category))
        .order("desc")
        .collect()
    : await ctx.db.query("tools").order("desc").collect();
  return rows.filter((t) => t.deletedAt === undefined);
}

/**
 * A tool is "on loan" once an approved loan has started and until it's marked
 * returned — including past its end date (overdue tools are still out).
 */
async function isOnLoanToday(ctx: QueryCtx, toolId: Id<"tools">, today: string) {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .collect();
  return loans.some((l) => l.status === "approved" && l.startDate <= today);
}

/**
 * PUBLIC (no auth). Projects only name + category — never owner, description
 * or availability, so anonymous visitors learn nothing about neighbors.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await activeTools(ctx);
    return tools.slice(0, 100).map((t) => ({ _id: t._id, name: t.name, category: t.category }));
  },
});

/** Authenticated browse view with availability and owner display name. */
export const list = query({
  args: { category: v.optional(vCategory) },
  handler: async (ctx, { category }) => {
    const me = await requireUser(ctx);
    const today = todayUtc();
    const tools = await activeTools(ctx, category);
    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          ownerName: owner?.name ?? "Neighbor",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: t.ownerId === me._id,
          onLoan: await isOnLoanToday(ctx, t._id, today),
        };
      }),
    );
  },
});

/** Single tool with its upcoming approved date ranges (for the request form). */
export const get = query({
  // Accepts a raw string because it comes straight from the URL.
  args: { toolId: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const toolId = ctx.db.normalizeId("tools", args.toolId);
    if (!toolId) return null;
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt !== undefined) return null;
    const owner = await ctx.db.get(tool.ownerId);
    const today = todayUtc();
    const booked = (
      await ctx.db
        .query("loans")
        .withIndex("by_tool", (q) => q.eq("toolId", toolId))
        .collect()
    )
      .filter((l) => l.status === "approved" && l.endDate >= today)
      .map((l) => ({ startDate: l.startDate, endDate: l.endDate }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return {
      _id: tool._id,
      name: tool.name,
      category: tool.category,
      condition: tool.condition,
      description: tool.description,
      ownerName: owner?.name ?? "Neighbor",
      ownerTrusted: owner?.trustedLender ?? false,
      isMine: tool.ownerId === me._id,
      booked,
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return tools.filter((t) => t.deletedAt === undefined);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const { name, description } = cleanToolInput(args);
    return await ctx.db.insert("tools", {
      ownerId: user._id,
      name,
      description,
      category: args.category,
      condition: args.condition,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
  },
  handler: async (ctx, { toolId, ...args }) => {
    await requireToolOwner(ctx, toolId);
    const { name, description } = cleanToolInput(args);
    await ctx.db.patch(toolId, {
      name,
      description,
      category: args.category,
      condition: args.condition,
    });
  },
});

/** Owner soft-deletes a tool. Refused while a loan is active or pending. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    await requireToolOwner(ctx, toolId);
    const open = (
      await ctx.db
        .query("loans")
        .withIndex("by_tool", (q) => q.eq("toolId", toolId))
        .collect()
    ).some((l) => l.status === "approved" || l.status === "requested");
    if (open) {
      throw new ConvexError("Resolve pending requests and active loans before deleting.");
    }
    await ctx.db.patch(toolId, { deletedAt: Date.now() });
  },
});
