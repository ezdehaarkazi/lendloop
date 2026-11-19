/**
 * Fails (exit 1) if any exported n8n workflow/credential JSON contains
 * something that looks like a secret. Run in CI and before committing exports:
 *
 *   pnpm check:secrets [dir...]   (default: n8n/)
 *
 * Checks:
 *  1. Exact values of known secret env vars (from the environment and ./.env).
 *  2. High-risk patterns: private keys, JWTs, Clerk/Stripe/AWS/Slack/GitHub keys,
 *     bearer tokens, URLs with embedded credentials, long hex/base64 blobs.
 *  3. Non-empty values under sensitive keys (password, secret, token, apiKey…)
 *     unless they are n8n expressions like "={{ $env.X }}".
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Finding = { file: string; path: string; reason: string };

const SECRET_ENV_NAMES = [
  "N8N_WEBHOOK_SECRET",
  "LENDLOOP_WEBHOOK_SECRET",
  "N8N_ENCRYPTION_KEY",
  "CLERK_SECRET_KEY",
  "SMTP_PASSWORD",
];

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}/, "Clerk/Stripe-style API key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i, "bearer token"],
  [/[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:[^\s/@"']+@/i, "URL with embedded credentials"],
  [/\b[0-9a-f]{32,}\b/i, "long hex string (looks like a key)"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])/, "long base64 string (looks like a key)"],
];

const SENSITIVE_KEY = /(pass(word)?|secret|token|api[-_]?key|private[-_]?key|client[-_]?secret|auth(orization)?)$/i;
const SAFE_VALUE = /^(=?\{\{[\s\S]*\}\}|)$/; // empty or an n8n expression

function loadDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function knownSecrets(env: Record<string, string | undefined>): string[] {
  return SECRET_ENV_NAMES.map((n) => env[n]).filter((v): v is string => !!v && v.length >= 8);
}

/** Walks any JSON value, reporting suspicious strings with their JSON path. */
export function scanJson(value: unknown, file: string, secrets: string[], path = "$"): Finding[] {
  if (typeof value === "string") return scanString(value, file, path, secrets);
  if (Array.isArray(value)) return value.flatMap((v, i) => scanJson(v, file, secrets, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const here = `${path}.${k}`;
      const found = scanJson(v, file, secrets, here);
      if (SENSITIVE_KEY.test(k) && typeof v === "string" && !SAFE_VALUE.test(v.trim())) {
        found.push({ file, path: here, reason: `non-empty value under sensitive key "${k}"` });
      }
      return found;
    });
  }
  return [];
}

function scanString(s: string, file: string, path: string, secrets: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const secret of secrets) {
    if (s.includes(secret)) findings.push({ file, path, reason: "contains the value of a secret env var" });
  }
  // Code-node source legitimately contains long identifiers; strip n8n expressions first.
  const text = s.replace(/\{\{[\s\S]*?\}\}/g, "");
  for (const [re, reason] of PATTERNS) {
    if (re.test(text)) findings.push({ file, path, reason });
  }
  return findings;
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsonFiles(full);
    return name.endsWith(".json") ? [full] : [];
  });
}

function main() {
  const dirs = process.argv.slice(2);
  const targets = (dirs.length ? dirs : ["n8n"]).flatMap(jsonFiles);
  const secrets = knownSecrets({ ...loadDotEnv(".env"), ...loadDotEnv(".env.local"), ...process.env });

  const findings = targets.flatMap((file) => {
    try {
      return scanJson(JSON.parse(readFileSync(file, "utf8")), relative(process.cwd(), file), secrets);
    } catch (err) {
      return [{ file, path: "$", reason: `invalid JSON: ${(err as Error).message}` }];
    }
  });

  if (findings.length === 0) {
    console.log(`✔ No secrets found in ${targets.length} n8n JSON file(s).`);
    return;
  }
  console.error(`✖ Possible secrets in exported n8n JSON (${findings.length}):`);
  for (const f of findings) console.error(`  ${f.file}  ${f.path}\n    → ${f.reason}`);
  console.error("\nMove the value into an n8n credential or $env variable, re-export, and re-run.");
  process.exit(1);
}

if (process.argv[1] && /check-workflow-secrets\.ts$/.test(process.argv[1])) main();
