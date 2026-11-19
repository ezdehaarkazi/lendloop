import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

function isMutationCtx(ctx: Ctx): ctx is MutationCtx {
  return "insert" in ctx.db;
}

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Returns the current user's row, or null if signed out / not yet synced. */
export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

/**
 * Creates or refreshes the user row from the Clerk identity. Role is never
 * taken from the client: it defaults to "user", and ADMIN_EMAILS (a Convex
 * env var) can only ever promote, never demote.
 */
export async function upsertUserFromIdentity(ctx: MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("You must be signed in.");

  const email = (identity.email ?? "").toLowerCase();
  const name = identity.name ?? identity.givenName ?? email.split("@")[0] ?? "Neighbor";
  const shouldBeAdmin = email !== "" && identity.emailVerified !== false && adminEmails().has(email);

  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (existing) {
    const patch: Partial<Doc<"users">> = {};
    if (existing.name !== name) patch.name = name;
    if (email && existing.email !== email) patch.email = email;
    if (shouldBeAdmin && existing.role !== "admin") patch.role = "admin";
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
    return { ...existing, ...patch };
  }

  const id = await ctx.db.insert("users", {
    clerkId: identity.subject,
    name,
    email,
    role: shouldBeAdmin ? "admin" : "user",
    trustedLender: false,
    createdAt: Date.now(),
  });
  const created = await ctx.db.get(id);
  if (!created) throw new ConvexError("Failed to create user.");
  return created;
}

/**
 * Requires an authenticated user. In mutations the row is upserted on first
 * call; in queries (read-only) a missing row is treated as unauthenticated.
 */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (user) return user;
  if (isMutationCtx(ctx)) return await upsertUserFromIdentity(ctx);
  throw new ConvexError("You must be signed in.");
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw new ConvexError("Admin access required.");
  return user;
}

/** Requires the current user to own a (non-deleted) tool. */
export async function requireToolOwner(
  ctx: Ctx,
  toolId: Id<"tools">,
): Promise<{ user: Doc<"users">; tool: Doc<"tools"> }> {
  const user = await requireUser(ctx);
  const tool = await ctx.db.get(toolId);
  // Same error for "missing" and "not yours" so IDs can't be probed.
  if (!tool || tool.deletedAt !== undefined || tool.ownerId !== user._id) {
    throw new ConvexError("Tool not found.");
  }
  return { user, tool };
}

export type LoanParty = "owner" | "borrower";

/** Requires the current user to be the given party (or either party) on a loan. */
export async function requireLoanParty(
  ctx: Ctx,
  loanId: Id<"loans">,
  party: LoanParty | "either",
): Promise<{ user: Doc<"users">; loan: Doc<"loans"> }> {
  const user = await requireUser(ctx);
  const loan = await ctx.db.get(loanId);
  const isOwner = loan?.ownerId === user._id;
  const isBorrower = loan?.borrowerId === user._id;
  const allowed =
    party === "owner" ? isOwner : party === "borrower" ? isBorrower : isOwner || isBorrower;
  if (!loan || !allowed) throw new ConvexError("Loan not found.");
  return { user, loan };
}
