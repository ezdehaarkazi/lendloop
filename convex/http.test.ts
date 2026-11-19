import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sign } from "./lib/hmac";
import { isoDay, sampleTool, setup, signIn, type T } from "./test.setup";

const SECRET = "http-test-secret";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.N8N_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.N8N_WEBHOOK_SECRET;
});

async function signedHeaders(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const timestamp = String(ts);
  return {
    "Content-Type": "application/json",
    "X-LendLoop-Timestamp": timestamp,
    "X-LendLoop-Signature": await sign(secret, timestamp, body),
  };
}

/** Creates an approved loan whose end date is in the past. */
async function overdueLoan(t: T): Promise<Id<"loans">> {
  const owner = await signIn(t, "Owner");
  const borrower = await signIn(t, "Bea Borrower");
  const toolId = await owner.as.mutation(api.tools.create, sampleTool);
  const loanId = await borrower.as.mutation(api.loans.request, { toolId, startDate: isoDay(0), endDate: isoDay(1) });
  await owner.as.mutation(api.loans.approve, { loanId });
  await t.run((ctx) => ctx.db.patch(loanId, { startDate: isoDay(-5), endDate: isoDay(-2) }));
  return loanId;
}

describe("GET /automation/overdue-loans", () => {
  it("rejects unsigned, wrongly signed and stale requests", async () => {
    const t = setup();
    expect((await t.fetch("/automation/overdue-loans")).status).toBe(401);
    const bad = await t.fetch("/automation/overdue-loans", { headers: await signedHeaders("", "wrong") });
    expect(bad.status).toBe(401);
    const stale = await t.fetch("/automation/overdue-loans", {
      headers: await signedHeaders("", SECRET, Math.floor(Date.now() / 1000) - 600),
    });
    expect(stale.status).toBe(401);
  });

  it("returns minimized overdue loans", async () => {
    const t = setup();
    const loanId = await overdueLoan(t);
    const res = await t.fetch("/automation/overdue-loans", { headers: await signedHeaders("") });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loans).toHaveLength(1);
    expect(body.loans[0]).toEqual({
      loanId,
      toolName: sampleTool.name,
      endDate: isoDay(-2),
      daysOverdue: 2,
      borrower: { email: "bea.borrower@example.com", firstName: "Bea" },
      idempotencyKey: `${loanId}:${body.date}`,
    });
  });
});

describe("POST /automation/reminder-status", () => {
  it("is idempotent on idempotencyKey", async () => {
    const t = setup();
    const loanId = await overdueLoan(t);
    const body = JSON.stringify({
      loanId,
      type: "overdue_reminder",
      idempotencyKey: `${loanId}:${isoDay(0)}`,
      status: "sent",
    });
    const post = async () =>
      t.fetch("/automation/reminder-status", { method: "POST", body, headers: await signedHeaders(body) });

    const first = await post();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, duplicate: false });
    const second = await post();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events).toHaveLength(1);
  });

  it("rejects bodies with a key for a different loan or bad fields", async () => {
    const t = setup();
    const loanId = await overdueLoan(t);
    for (const payload of [
      { loanId, type: "overdue_reminder", idempotencyKey: "someoneElse:2026-01-01", status: "sent" },
      { loanId, type: "nope", idempotencyKey: `${loanId}:x`, status: "sent" },
      { loanId: "not-an-id", type: "overdue_reminder", idempotencyKey: "not-an-id:x", status: "sent" },
    ]) {
      const body = JSON.stringify(payload);
      const res = await t.fetch("/automation/reminder-status", {
        method: "POST",
        body,
        headers: await signedHeaders(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a body that was altered after signing", async () => {
    const t = setup();
    const loanId = await overdueLoan(t);
    const body = JSON.stringify({ loanId, type: "overdue_reminder", idempotencyKey: `${loanId}:d`, status: "sent" });
    const headers = await signedHeaders(body);
    const res = await t.fetch("/automation/reminder-status", {
      method: "POST",
      body: body.replace("sent", "failed"),
      headers,
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /automation/workflow-error", () => {
  it("records failures for the admin page", async () => {
    const t = setup();
    const body = JSON.stringify({ workflow: "Overdue reminders", node: "Send email", message: "SMTP down" });
    const res = await t.fetch("/automation/workflow-error", { method: "POST", body, headers: await signedHeaders(body) });
    expect(res.status).toBe(200);
    const rows = await t.run((ctx) => ctx.db.query("automationErrors").collect());
    expect(rows[0]).toMatchObject({ workflow: "Overdue reminders", message: "SMTP down" });
  });
});
