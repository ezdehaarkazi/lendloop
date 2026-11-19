import { describe, expect, it } from "vitest";
import { daysInclusive, rangesOverlap, todayUtc, validateLoanRange } from "./dates";
import { sign, timingSafeEqual, verify } from "./hmac";
import { backoffMs } from "./outbox";

describe("dates", () => {
  const today = "2026-03-10";

  it("accepts a valid range up to 30 days", () => {
    expect(() => validateLoanRange("2026-03-10", "2026-04-08", today)).not.toThrow();
    expect(daysInclusive("2026-03-10", "2026-04-08")).toBe(30);
  });

  it.each([
    ["2026-03-09", "2026-03-12", /past/],
    ["2026-03-12", "2026-03-11", /on or after/],
    ["2026-03-10", "2026-04-09", /at most 30/],
    ["2026-02-30", "2026-03-12", /Invalid date/],
    ["10/03/2026", "2026-03-12", /Invalid date/],
  ])("rejects %s → %s", (start, end, msg) => {
    expect(() => validateLoanRange(start, end, today)).toThrow(msg);
  });

  it("detects inclusive overlaps", () => {
    const a = { startDate: "2026-03-10", endDate: "2026-03-12" };
    expect(rangesOverlap(a, { startDate: "2026-03-12", endDate: "2026-03-14" })).toBe(true);
    expect(rangesOverlap(a, { startDate: "2026-03-13", endDate: "2026-03-14" })).toBe(false);
  });

  it("formats today in UTC", () => {
    expect(todayUtc(Date.parse("2026-03-10T23:59:59Z"))).toBe("2026-03-10");
  });
});

describe("hmac", () => {
  const secret = "test-secret";
  const body = '{"hello":"world"}';

  it("matches node:crypto's HMAC (the algorithm n8n uses to verify)", async () => {
    // node -e 'crypto.createHmac("sha256","test-secret").update(`1700000000.${body}`).digest("hex")'
    expect(await sign(secret, "1700000000", body)).toBe(
      "f85455a1b55ea86f7a15f5f9923d0abc4b888da84ec485f2ff358f427776beca",
    );
  });

  it("verifies a fresh, correct signature", async () => {
    const ts = "1700000000";
    const signature = await sign(secret, ts, body);
    const res = await verify({ secret, signature, timestamp: ts, rawBody: body, nowSeconds: 1700000100 });
    expect(res).toEqual({ ok: true });
  });

  it("rejects tampered bodies, wrong secrets, stale and missing headers", async () => {
    const ts = "1700000000";
    const signature = await sign(secret, ts, body);
    const base = { secret, signature, timestamp: ts, rawBody: body, nowSeconds: 1700000000 };
    expect((await verify({ ...base, rawBody: body + " " })).ok).toBe(false);
    expect((await verify({ ...base, secret: "other" })).ok).toBe(false);
    expect((await verify({ ...base, nowSeconds: 1700000000 + 301 })).ok).toBe(false);
    expect((await verify({ ...base, signature: null })).ok).toBe(false);
    expect((await verify({ ...base, secret: undefined })).ok).toBe(false);
    expect((await verify({ ...base, timestamp: "abc" })).ok).toBe(false);
  });

  it("compares strings without short-circuiting on length", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("backoff", () => {
  it("grows exponentially and is capped", () => {
    const max = () => 1; // upper bound of jitter
    expect(backoffMs(1, max)).toBe(30_000);
    expect(backoffMs(2, max)).toBe(60_000);
    expect(backoffMs(3, max)).toBe(120_000);
    expect(backoffMs(20, max)).toBe(3_600_000);
    expect(backoffMs(1, () => 0)).toBe(15_000);
  });
});
