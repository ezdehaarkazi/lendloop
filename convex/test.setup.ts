/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

export const modules = import.meta.glob("./**/*.*s");

export function setup() {
  return convexTest(schema, modules);
}

export type T = ReturnType<typeof setup>;

/** Creates a signed-in user (via the real upsert path) and returns a client + id. */
export async function signIn(t: T, name: string, email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`) {
  const as = t.withIdentity({ subject: `clerk_${name}`, name, email, emailVerified: true });
  const userId = await as.mutation(api.users.store, {});
  return { as, userId };
}

export async function makeAdmin(t: T, userId: Id<"users">) {
  await t.run(async (ctx) => ctx.db.patch(userId, { role: "admin" }));
}

export function isoDay(offsetDays: number, from = Date.now()): string {
  return new Date(from + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export const sampleTool = {
  name: "Cordless drill",
  category: "power_tools",
  condition: "good",
  description: "18V with two batteries",
} as const;
