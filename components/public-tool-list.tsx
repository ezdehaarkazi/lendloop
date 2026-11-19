"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/lib/format";
import { EmptyState, SkeletonList } from "./ui";

/** Anonymous list: only name + category come back from the server. */
export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic);
  if (tools === undefined) return <SkeletonList rows={2} />;
  if (tools.length === 0) {
    return <EmptyState title="No tools listed yet" body="Be the first neighbor to lend something." />;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((t) => (
        <li key={t._id} className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
          <p className="font-medium">{t.name}</p>
          <p className="text-sm text-stone-500">{CATEGORY_LABELS[t.category]}</p>
        </li>
      ))}
    </ul>
  );
}
