import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { todayUtc } from "./lib/dates";
import { enqueueLoanEvent } from "./lib/outbox";
import type { Category, Condition } from "./lib/validators";

const DAY = 86_400_000;
const day = (offset: number) => todayUtc(Date.now() + offset * DAY);

async function demoUser(ctx: MutationCtx, name: string, email: string, trusted = false) {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("users", {
    clerkId: `seed|${email}`, // never matches a real Clerk subject
    name,
    email,
    role: "user",
    trustedLender: trusted,
    createdAt: Date.now(),
  });
}

async function demoTool(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  name: string,
  category: Category,
  condition: Condition,
  description: string,
) {
  return await ctx.db.insert("tools", { ownerId, name, category, condition, description, createdAt: Date.now() });
}

/**
 * Demo data: three neighbors, a handful of tools, one pending request (which
 * fires Workflow A) and one overdue loan (picked up by Workflow B).
 * Run: `pnpm seed` (or `npx convex run seed:run`). Safe to re-run; skips if seeded.
 */
export const run = internalMutation({
  args: { notify: v.optional(v.boolean()) },
  handler: async (ctx, { notify = true }) => {
    const already = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "maya@lendloop.demo"))
      .unique();
    if (already) return "Already seeded.";

    const maya = await demoUser(ctx, "Maya Chen", "maya@lendloop.demo", true);
    const sam = await demoUser(ctx, "Sam Okafor", "sam@lendloop.demo");
    const lena = await demoUser(ctx, "Lena Novak", "lena@lendloop.demo");

    const drill = await demoTool(ctx, maya, "Cordless drill", "power_tools", "good", "18V, two batteries and a basic bit set.");
    await demoTool(ctx, maya, "Pressure washer", "cleaning", "fair", "Great for decks. Bring your own extension cord.");
    const tent = await demoTool(ctx, sam, "4-person tent", "camping", "good", "Pop-up, fits in a car trunk.");
    await demoTool(ctx, sam, "Hedge trimmer", "garden", "worn", "Works fine, blade could use sharpening.");
    await demoTool(ctx, lena, "Stand mixer", "kitchen", "new", "Includes dough hook and whisk.");

    const now = Date.now();
    const pendingId = await ctx.db.insert("loans", {
      toolId: drill, borrowerId: lena, ownerId: maya,
      startDate: day(2), endDate: day(4), status: "requested", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("loans", {
      toolId: tent, borrowerId: maya, ownerId: sam,
      startDate: day(-6), endDate: day(-2), status: "approved", createdAt: now - 8 * DAY, updatedAt: now - 7 * DAY,
    });

    if (notify) {
      const pending = await ctx.db.get(pendingId);
      if (pending) await enqueueLoanEvent(ctx, pending);
    }
    return "Seeded 3 users, 5 tools, 1 pending request, 1 overdue loan.";
  },
});
