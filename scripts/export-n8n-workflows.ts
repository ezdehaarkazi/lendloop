/**
 * Exports the LendLoop workflows from the running n8n container into
 * n8n/workflows/, normalized for the repo, then runs the secret check.
 *
 *   pnpm n8n:export
 *
 * Raw n8n exports carry instance-specific data (project/owner info in
 * `shared`, timestamps, version ids, trigger counts). Those are stripped so
 * the files are reviewable, diff cleanly and import into any instance.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILES: Record<string, string> = {
  LLrequestNotify1: "request-notification.json",
  LLoverdueRemind1: "overdue-reminders.json",
  LLerrorHandler01: "error-handler.json",
};

// Only these top-level keys are kept; everything else is instance state.
const KEEP = ["id", "name", "active", "isArchived", "settings", "nodes", "connections", "pinData", "tags"] as const;

function docker(args: string[]): string {
  return execFileSync("docker", ["compose", ...args], {
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
}

export function normalize(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEEP) if (key in raw) out[key] = raw[key];
  out.active = false; // imported inactive; `pnpm n8n:import` publishes them
  out.pinData = {}; // pinned test data may contain real payloads
  out.tags = [];
  return out;
}

function main() {
  docker(["exec", "n8n", "sh", "-c", "rm -rf /tmp/ll-export && mkdir -p /tmp/ll-export && n8n export:workflow --all --separate --output=/tmp/ll-export/"]);
  const dir = mkdtempSync(join(tmpdir(), "n8n-export-"));
  try {
    docker(["cp", "n8n:/tmp/ll-export/.", dir]);
    const exported = readdirSync(dir);
    for (const [id, file] of Object.entries(FILES)) {
      if (!exported.includes(`${id}.json`)) throw new Error(`Workflow ${id} not found in n8n — run pnpm n8n:import first.`);
      const raw = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as Record<string, unknown>;
      writeFileSync(join("n8n", "workflows", file), JSON.stringify(normalize(raw), null, 2) + "\n");
      console.log(`✔ ${id} → n8n/workflows/${file}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  execFileSync("pnpm", ["-s", "check:secrets"], { stdio: "inherit", shell: process.platform === "win32" });
}

if (process.argv[1] && /export-n8n-workflows\.ts$/.test(process.argv[1])) main();
