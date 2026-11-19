import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { todayUtc } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/hmac";

const MAX_BODY_BYTES = 16 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type SignedHandler = (ctx: ActionCtx, rawBody: string) => Promise<Response>;

/**
 * Wraps a handler with HMAC verification + replay window. The body is read
 * as raw text *before* parsing so the signature covers the exact bytes.
 */
function signed(handler: SignedHandler) {
  return httpAction(async (ctx, req) => {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) return json(413, { error: "payload too large" });

    const result = await verify({
      secret: process.env.N8N_WEBHOOK_SECRET,
      signature: req.headers.get(SIGNATURE_HEADER),
      timestamp: req.headers.get(TIMESTAMP_HEADER),
      rawBody,
    });
    if (!result.ok) {
      console.warn(`Rejected automation request to ${new URL(req.url).pathname}: ${result.reason}`);
      // Generic message: don't tell callers which check failed.
      return json(401, { error: "unauthorized" });
    }

    try {
      return await handler(ctx, rawBody);
    } catch (err) {
      if (err instanceof ConvexError) return json(400, { error: String(err.data) });
      console.error("Automation endpoint error", err);
      return json(500, { error: "internal error" });
    }
  });
}

function parseObject(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);

const http = httpRouter();

/** n8n Workflow B: list overdue loans. Signed GET with an empty body. */
http.route({
  path: "/automation/overdue-loans",
  method: "GET",
  handler: signed(async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today });
    return json(200, { date: today, loans });
  }),
});

/** n8n write-back: idempotent record of a sent/failed notification or reminder. */
http.route({
  path: "/automation/reminder-status",
  method: "POST",
  handler: signed(async (ctx, rawBody) => {
    const body = parseObject(rawBody);
    const loanId = str(body?.loanId);
    const idempotencyKey = str(body?.idempotencyKey);
    const type = body?.type;
    const status = body?.status;
    if (
      !loanId ||
      !idempotencyKey ||
      !KEY_PATTERN.test(idempotencyKey) ||
      (type !== "overdue_reminder" && type !== "request_notification") ||
      (status !== "sent" && status !== "failed")
    ) {
      return json(400, { error: "invalid body" });
    }
    const result = await ctx.runMutation(internal.automation.recordEvent, {
      loanId,
      idempotencyKey,
      type,
      status,
      error: str(body?.error),
    });
    // Duplicates are success (200) so n8n retries don't turn into errors.
    return json(200, { ok: true, duplicate: result.duplicate });
  }),
});

/** n8n Error Workflow: record a workflow-level failure for the admin page. */
http.route({
  path: "/automation/workflow-error",
  method: "POST",
  handler: signed(async (ctx, rawBody) => {
    const body = parseObject(rawBody);
    const workflow = str(body?.workflow);
    const message = str(body?.message);
    if (!workflow || !message) return json(400, { error: "invalid body" });
    await ctx.runMutation(internal.automation.recordWorkflowError, {
      workflow,
      message,
      node: str(body?.node),
      executionId: str(body?.executionId),
    });
    return json(200, { ok: true });
  }),
});

export default http;
