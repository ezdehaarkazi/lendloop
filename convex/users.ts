import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser, upsertUserFromIdentity } from "./lib/auth";

/** Called by the client right after sign-in to create/refresh the user row. */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await upsertUserFromIdentity(ctx);
    return user._id;
  },
});

/** The signed-in user's own profile (only fields the UI needs). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

/**
 * Bootstrap/maintenance: promote or demote a user by email.
 * Internal only — run via `npx convex run users:setRoleByEmail '{...}'`.
 */
export const setRoleByEmail = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("admin"), v.literal("user")) },
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();
    if (!user) throw new Error(`No user with email ${email}. Sign in once first.`);
    await ctx.db.patch(user._id, { role });
    return { userId: user._id, role };
  },
});
