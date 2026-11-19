import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { requireAdmin, requireLoanParty, requireToolOwner, requireUser } from "./lib/auth";
import { isoDay, makeAdmin, sampleTool, setup, signIn } from "./test.setup";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete process.env.ADMIN_EMAILS;
});

describe("requireUser", () => {
  it("rejects anonymous callers", async () => {
    const t = setup();
    await expect(t.mutation(api.tools.create, sampleTool)).rejects.toThrow(/signed in/);
    await expect(t.query(api.tools.list, {})).rejects.toThrow(/signed in/);
  });

  it("upserts the user from the Clerk identity with role=user", async () => {
    const t = setup();
    const { userId } = await signIn(t, "Alice");
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user).toMatchObject({ name: "Alice", email: "alice@example.com", role: "user", trustedLender: false });
  });

  it("falls back sensibly when the token has no/empty profile claims", async () => {
    const t = setup();
    const bare = t.withIdentity({ subject: "clerk_bare", name: "", email: "" });
    const id = await bare.mutation(api.users.store, {});
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ name: "Neighbor", email: "", role: "user" });
  });

  it("upserts on first mutation even without calling users.store", async () => {
    const t = setup();
    const as = t.withIdentity({ subject: "clerk_new", name: "New", email: "new@example.com" });
    await as.mutation(api.tools.create, sampleTool);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect((await as.run((ctx) => requireUser(ctx)))._id).toBe(users[0]._id);
  });

  it("promotes verified ADMIN_EMAILS on sign-in, never from client input", async () => {
    process.env.ADMIN_EMAILS = "Boss@Example.com, other@example.com";
    const t = setup();
    const { userId } = await signIn(t, "Boss");
    expect((await t.run((ctx) => ctx.db.get(userId)))?.role).toBe("admin");

    const unverified = t.withIdentity({ subject: "clerk_x", name: "X", email: "other@example.com", emailVerified: false });
    const xId = await unverified.mutation(api.users.store, {});
    expect((await t.run((ctx) => ctx.db.get(xId)))?.role).toBe("user");
  });
});

describe("requireAdmin", () => {
  it("blocks regular users from admin functions", async () => {
    const t = setup();
    const { as, userId } = await signIn(t, "Alice");
    await expect(as.query(api.admin.listLoans, {})).rejects.toThrow(/Admin/);
    await expect(as.mutation(api.admin.setTrustedLender, { userId, trusted: true })).rejects.toThrow(/Admin/);
  });

  it("lets admins act", async () => {
    const t = setup();
    const { as, userId } = await signIn(t, "Root");
    await makeAdmin(t, userId);
    await as.mutation(api.admin.setTrustedLender, { userId, trusted: true });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.trustedLender).toBe(true);
    await expect(t.withIdentity({ subject: "clerk_Root" }).run((ctx) => requireAdmin(ctx))).resolves.toBeTruthy();
  });
});

describe("requireToolOwner", () => {
  it("only the owner can edit or delete a tool", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await alice.as.mutation(api.tools.create, sampleTool);

    await expect(bob.as.mutation(api.tools.update, { toolId, ...sampleTool, name: "Hacked" })).rejects.toThrow(/not found/);
    await expect(bob.as.mutation(api.tools.remove, { toolId })).rejects.toThrow(/not found/);
    await expect(bob.as.run((ctx) => requireToolOwner(ctx, toolId))).rejects.toThrow(/not found/);

    await alice.as.mutation(api.tools.update, { toolId, ...sampleTool, name: "Hammer drill" });
    expect((await alice.as.run((ctx) => requireToolOwner(ctx, toolId))).tool.name).toBe("Hammer drill");
  });

  it("validates input server-side", async () => {
    const t = setup();
    const { as } = await signIn(t, "Alice");
    await expect(as.mutation(api.tools.create, { ...sampleTool, description: "x".repeat(281) })).rejects.toThrow(/280/);
    await expect(as.mutation(api.tools.create, { ...sampleTool, name: " " })).rejects.toThrow(/Name/);
    // @ts-expect-error invalid category is rejected by the v.union validator
    await expect(as.mutation(api.tools.create, { ...sampleTool, category: "weapons" })).rejects.toThrow();
  });
});

describe("requireLoanParty", () => {
  async function withLoan() {
    const t = setup();
    const owner = await signIn(t, "Owner");
    const borrower = await signIn(t, "Borrower");
    const stranger = await signIn(t, "Stranger");
    const toolId = await owner.as.mutation(api.tools.create, sampleTool);
    const loanId = await borrower.as.mutation(api.loans.request, {
      toolId,
      startDate: isoDay(1),
      endDate: isoDay(3),
    });
    return { t, owner, borrower, stranger, loanId };
  }

  it("borrower cannot approve; stranger cannot touch the loan", async () => {
    const { borrower, stranger, loanId } = await withLoan();
    await expect(borrower.as.mutation(api.loans.approve, { loanId })).rejects.toThrow(/not found/);
    await expect(stranger.as.mutation(api.loans.decline, { loanId })).rejects.toThrow(/not found/);
    await expect(stranger.as.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/not found/);
    await expect(stranger.as.run((ctx) => requireLoanParty(ctx, loanId, "either"))).rejects.toThrow();
  });

  it("owner cannot cancel the borrower's request", async () => {
    const { owner, loanId } = await withLoan();
    await expect(owner.as.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/not found/);
    await expect(owner.as.run((ctx) => requireLoanParty(ctx, loanId, "owner"))).resolves.toBeTruthy();
  });

  it("users only see their own loans", async () => {
    const { borrower, stranger } = await withLoan();
    expect(await borrower.as.query(api.loans.listMine, {})).toHaveLength(1);
    expect(await stranger.as.query(api.loans.listMine, {})).toHaveLength(0);
    expect(await stranger.as.query(api.loans.listIncoming, {})).toHaveLength(0);
  });
});
