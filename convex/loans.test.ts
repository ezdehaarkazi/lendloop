import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { isoDay, makeAdmin, sampleTool, setup, signIn } from "./test.setup";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function scenario() {
  const t = setup();
  const owner = await signIn(t, "Olivia Owner");
  const borrower = await signIn(t, "Ben Borrower");
  const toolId = await owner.as.mutation(api.tools.create, sampleTool);
  return { t, owner, borrower, toolId };
}

describe("loan flow", () => {
  it("blocks requests on your own tool and invalid ranges", async () => {
    const { owner, borrower, toolId } = await scenario();
    await expect(
      owner.as.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) }),
    ).rejects.toThrow(/own tool/);
    await expect(
      borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(-1), endDate: isoDay(2) }),
    ).rejects.toThrow(/past/);
    await expect(
      borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(40) }),
    ).rejects.toThrow(/30 days/);
  });

  it("runs request â†’ approve â†’ returned and enforces the state machine", async () => {
    const { t, owner, borrower, toolId } = await scenario();
    const loanId = await borrower.as.mutation(api.loans.request, {
      toolId,
      startDate: isoDay(0),
      endDate: isoDay(2),
    });
    await expect(owner.as.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(/Cannot change/);
    await owner.as.mutation(api.loans.approve, { loanId });
    await expect(borrower.as.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/Cannot change/);
    await expect(owner.as.mutation(api.loans.decline, { loanId })).rejects.toThrow(/Cannot change/);
    await owner.as.mutation(api.loans.markReturned, { loanId });

    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.status).toBe("returned");
    expect(loan?.returnedAt).toBeTypeOf("number");
  });

  it("blocks requests and approvals overlapping an approved loan", async () => {
    const { t, owner, borrower, toolId } = await scenario();
    const other = await signIn(t, "Cara");
    const first = await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(5) });
    const second = await other.as.mutation(api.loans.request, { toolId, startDate: isoDay(4), endDate: isoDay(6) });
    await owner.as.mutation(api.loans.approve, { loanId: first });

    await expect(owner.as.mutation(api.loans.approve, { loanId: second })).rejects.toThrow(/overlaps/);
    await expect(
      other.as.mutation(api.loans.request, { toolId, startDate: isoDay(5), endDate: isoDay(7) }),
    ).rejects.toThrow(/overlap/);
    // A range adjacent to the approved loan is fine.
    await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(6), endDate: isoDay(7) });
  });

  it("lets the borrower cancel only a pending request", async () => {
    const { t, borrower, toolId } = await scenario();
    const loanId = await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
    await borrower.as.mutation(api.loans.cancel, { loanId });
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.status).toBe("cancelled");
  });

  it("refuses to delete a tool with open requests; admin removal declines them", async () => {
    const { t, owner, borrower, toolId } = await scenario();
    const loanId = await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
    await expect(owner.as.mutation(api.tools.remove, { toolId })).rejects.toThrow(/pending/);

    const admin = await signIn(t, "Admin");
    await makeAdmin(t, admin.userId);
    await admin.as.mutation(api.admin.removeTool, { toolId });
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.status).toBe("declined");
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(0);
  });
});

describe("availability", () => {
  it("keeps an overdue tool 'on loan' until it is marked returned", async () => {
    const { t, owner, borrower, toolId } = await scenario();
    const loanId = await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(0), endDate: isoDay(1) });
    await owner.as.mutation(api.loans.approve, { loanId });
    await t.run((ctx) => ctx.db.patch(loanId, { startDate: isoDay(-5), endDate: isoDay(-2) }));
    expect((await borrower.as.query(api.tools.list, {}))[0].onLoan).toBe(true);
    await owner.as.mutation(api.loans.markReturned, { loanId });
    expect((await borrower.as.query(api.tools.list, {}))[0].onLoan).toBe(false);
  });
});

describe("automation activity", () => {
  it("shows n8n write-backs on the loan for both parties, newest first", async () => {
    const { t, owner, borrower, toolId } = await scenario();
    const loanId = await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
    await t.run(async (ctx) => {
      await ctx.db.insert("automationEvents", {
        loanId, type: "request_notification", idempotencyKey: `${loanId}:requested`, status: "sent", createdAt: 1,
      });
      await ctx.db.insert("automationEvents", {
        loanId, type: "overdue_reminder", idempotencyKey: `${loanId}:2026-01-01`, status: "failed", createdAt: 2,
      });
    });
    const [mine] = await borrower.as.query(api.loans.listMine, {});
    expect(mine.activity.map((a) => `${a.label}:${a.status}`)).toEqual([
      "Overdue reminder:failed",
      "Request notice:sent",
    ]);
    const [incoming] = await owner.as.query(api.loans.listIncoming, {});
    expect(incoming.activity).toHaveLength(2);
  });
});

describe("outbox", () => {
  it("writes a data-minimized, signed-ready payload for each status change", async () => {
    const { t, owner, borrower, toolId } = await scenario();
    const loanId = await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
    await owner.as.mutation(api.loans.approve, { loanId });

    const rows = await t.run((ctx) =>
      ctx.db.query("webhookDeliveries").withIndex("by_loan", (q) => q.eq("loanId", loanId)).collect(),
    );
    expect(rows.map((r) => r.event)).toEqual(["loan.requested", "loan.approved"]);

    const requested = JSON.parse(rows[0].payload);
    expect(Object.keys(requested).sort()).toEqual(
      ["deliveryKey", "endDate", "event", "loanId", "recipient", "startDate", "status", "toolName"].sort(),
    );
    // Request goes to the owner, approval to the borrower; first names only.
    expect(requested.recipient).toEqual({ email: "olivia.owner@example.com", firstName: "Olivia" });
    expect(JSON.parse(rows[1].payload).recipient.firstName).toBe("Ben");
    expect(rows[0].payload).not.toContain(sampleTool.description);
  });

  it("delivers with HMAC headers and retries with backoff up to 5 attempts", async () => {
    process.env.N8N_WEBHOOK_URL = "http://n8n.test/webhook/lendloop";
    process.env.N8N_WEBHOOK_SECRET = "s3cret";
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { t, borrower, toolId } = await scenario();
      await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(fetchMock).toHaveBeenCalledTimes(5);
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-LendLoop-Signature"]).toMatch(/^[0-9a-f]{64}$/);
      expect(headers["X-LendLoop-Timestamp"]).toMatch(/^\d+$/);

      const [row] = await t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
      expect(row).toMatchObject({ status: "failed", attempts: 5 });
      expect(row.lastError).toContain("503");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.N8N_WEBHOOK_URL;
      delete process.env.N8N_WEBHOOK_SECRET;
    }
  });

  it("marks a delivery delivered on 2xx", async () => {
    process.env.N8N_WEBHOOK_URL = "http://n8n.test/webhook/lendloop";
    process.env.N8N_WEBHOOK_SECRET = "s3cret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    try {
      const { t, borrower, toolId } = await scenario();
      await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const [row] = await t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
      expect(row).toMatchObject({ status: "delivered", attempts: 1 });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.N8N_WEBHOOK_URL;
      delete process.env.N8N_WEBHOOK_SECRET;
    }
  });
});
