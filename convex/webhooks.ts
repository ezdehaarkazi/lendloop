import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from "./lib/hmac";
import { MAX_DELIVERY_ATTEMPTS, backoffMs } from "./lib/outbox";

/** How long a claimed delivery is reserved before the sweeper may retry it. */
const LEASE_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Atomically claims a pending delivery that is due. Returns null if it was
 * already delivered, permanently failed, or is leased by another attempt —
 * this is what makes duplicate scheduling (retry + sweeper) harmless.
 */
export const claim = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const d = await ctx.db.get(deliveryId);
    const now = Date.now();
    if (!d || d.status !== "pending" || d.nextAttemptAt > now + 1_000) return null;
    await ctx.db.patch(deliveryId, { nextAttemptAt: now + LEASE_MS });
    return { payload: d.payload };
  },
});

export const markDelivered = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const d = await ctx.db.get(deliveryId);
    if (!d) return;
    await ctx.db.patch(deliveryId, {
      status: "delivered",
      attempts: d.attempts + 1,
      lastError: undefined,
    });
  },
});

/** Records a failed attempt; schedules a backoff retry or gives up after max attempts. */
export const recordFailure = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), error: v.string() },
  handler: async (ctx, { deliveryId, error }) => {
    const d = await ctx.db.get(deliveryId);
    if (!d || d.status !== "pending") return;
    const attempts = d.attempts + 1;
    const lastError = error.slice(0, 500);
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      // Dead letter: stays visible in the admin page with a manual retry button.
      await ctx.db.patch(deliveryId, { attempts, lastError, status: "failed" });
      console.error(`Webhook ${deliveryId} failed permanently: ${lastError}`);
      return;
    }
    const delay = backoffMs(attempts);
    await ctx.db.patch(deliveryId, { attempts, lastError, nextAttemptAt: Date.now() + delay });
    await ctx.scheduler.runAfter(delay, internal.webhooks.deliver, { deliveryId });
  },
});

/** POSTs one outbox row to the n8n webhook, signed with HMAC-SHA256. */
export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const claimed = await ctx.runMutation(internal.webhooks.claim, { deliveryId });
    if (!claimed) return;

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.webhooks.recordFailure, {
        deliveryId,
        error: "N8N_WEBHOOK_URL / N8N_WEBHOOK_SECRET not configured",
      });
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sign(secret, timestamp, claimed.payload);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: signature,
          [TIMESTAMP_HEADER]: timestamp,
        },
        body: claimed.payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        await ctx.runMutation(internal.webhooks.markDelivered, { deliveryId });
      } else {
        const text = (await res.text().catch(() => "")).slice(0, 200);
        await ctx.runMutation(internal.webhooks.recordFailure, {
          deliveryId,
          error: `HTTP ${res.status} ${text}`.trim(),
        });
      }
    } catch (err) {
      await ctx.runMutation(internal.webhooks.recordFailure, {
        deliveryId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

/**
 * Safety net (cron): scheduled actions are at-most-once, so if one crashed
 * mid-flight its row would sit "pending" forever. Re-schedule any whose
 * lease/backoff has expired.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = (
      await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .take(500)
    ).filter((d) => d.nextAttemptAt < now);
    for (const d of stuck) {
      await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId: d._id });
    }
    return stuck.length;
  },
});
