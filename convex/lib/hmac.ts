/**
 * HMAC-SHA256 request signing shared by outbound webhooks (Convex → n8n)
 * and inbound automation calls (n8n → Convex).
 *
 *   signature = hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`))
 *   headers:   X-LendLoop-Signature, X-LendLoop-Timestamp (unix seconds)
 *
 * Uses Web Crypto so it runs in the Convex runtime, Node and tests.
 */

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sign(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  return toHex(mac);
}

/** Compares two strings in time independent of where they first differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verify(params: {
  secret: string | undefined;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  nowSeconds?: number;
}): Promise<VerifyResult> {
  const { secret, signature, timestamp, rawBody } = params;
  if (!secret) return { ok: false, reason: "server not configured" };
  if (!signature || !timestamp) return { ok: false, reason: "missing signature headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "invalid timestamp" };

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "timestamp outside allowed window" };
  }
  const expected = await sign(secret, timestamp, rawBody);
  return timingSafeEqual(expected, signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "bad signature" };
}
