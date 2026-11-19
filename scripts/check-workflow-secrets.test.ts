import { describe, expect, it } from "vitest";
import { knownSecrets, scanJson } from "./check-workflow-secrets";

const scan = (v: unknown, secrets: string[] = []) => scanJson(v, "wf.json", secrets);

describe("check-workflow-secrets", () => {
  it("passes env-var expressions and empty credential fields", () => {
    expect(
      scan({
        nodes: [{ parameters: { url: "={{ $env.LENDLOOP_CONVEX_SITE_URL }}/x", password: "" } }],
        credentials: { smtp: { id: "LLsmtpMailhog001", name: "SMTP" } },
        id: "a1a1a1a1-0000-4000-8000-000000000001",
      }),
    ).toEqual([]);
  });

  it("flags literal secret values, tokens and sensitive keys", () => {
    const secret = "f".repeat(64);
    const reasons = (v: unknown) => scan(v, [secret]).map((f) => f.reason);
    expect(reasons({ code: `createHmac('sha256', '${secret}')` }).join()).toMatch(/secret env var/);
    expect(reasons({ h: "Bearer abcdefghijklmnopqrstuvwxyz" }).join()).toMatch(/bearer/);
    expect(reasons({ k: "sk_live_abcdefghijklmnop" }).join()).toMatch(/API key/);
    expect(reasons({ apiKey: "hunter2hunter2" }).join()).toMatch(/sensitive key/);
    expect(reasons({ url: "smtp://user:pass@host" }).join()).toMatch(/embedded credentials/);
  });

  it("collects known secrets from env, ignoring short/empty values", () => {
    expect(knownSecrets({ N8N_WEBHOOK_SECRET: "x".repeat(40), CLERK_SECRET_KEY: "short" })).toEqual(["x".repeat(40)]);
  });
});
