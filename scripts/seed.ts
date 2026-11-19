/**
 * Seeds demo data into the current Convex deployment and (optionally) makes
 * an existing user an admin.
 *
 *   pnpm seed                         # demo users, tools, a pending request, an overdue loan
 *   pnpm seed --admin you@example.com # also promote that (already signed-in) user to admin
 *   pnpm seed --no-notify             # don't fire the n8n webhook for the seeded request
 */
import { spawnSync } from "node:child_process";

function convexRun(fn: string, args: Record<string, unknown>): void {
  const res = spawnSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const argv = process.argv.slice(2);
const adminIdx = argv.indexOf("--admin");
const adminEmail = adminIdx >= 0 ? argv[adminIdx + 1] : undefined;
if (adminIdx >= 0 && !adminEmail) {
  console.error("Usage: pnpm seed --admin you@example.com");
  process.exit(1);
}

convexRun("seed:run", { notify: !argv.includes("--no-notify") });
if (adminEmail) convexRun("users:setRoleByEmail", { email: adminEmail, role: "admin" });
