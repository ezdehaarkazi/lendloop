"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Badge, EmptyState, PageHeader, SkeletonList, TrustedBadge } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, type Category } from "@/convex/lib/validators";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/lib/format";

export default function BrowsePage() {
  const [category, setCategory] = useState<Category | undefined>();
  const tools = useQuery(api.tools.list, { category });

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm transition ${
      active ? "bg-brand-700 text-white" : "bg-white text-stone-700 ring-1 ring-stone-300 hover:bg-stone-100"
    }`;

  return (
    <>
      <PageHeader
        title="Browse tools"
        subtitle="Everything your neighbors are lending."
        actions={
          <Link
            href="/tools/new"
            className="rounded-lg bg-brand-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-800"
          >
            + List a tool
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <button className={chip(!category)} onClick={() => setCategory(undefined)} aria-pressed={!category}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} className={chip(category === c)} onClick={() => setCategory(c)} aria-pressed={category === c}>
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {tools === undefined ? (
        <SkeletonList />
      ) : tools.length === 0 ? (
        <EmptyState
          title={category ? `No ${CATEGORY_LABELS[category].toLowerCase()} tools yet` : "No tools yet"}
          body="Got something gathering dust? List it."
          action={{ href: "/tools/new", label: "List a tool" }}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t._id}>
              <Link
                href={`/tools/${t._id}`}
                className="block h-full rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-brand-600"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{t.name}</p>
                  {t.isMine ? (
                    <Badge>Yours</Badge>
                  ) : t.onLoan ? (
                    <Badge tone="amber">On loan</Badge>
                  ) : (
                    <Badge tone="green">Available</Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-stone-500">
                  {CATEGORY_LABELS[t.category]} · {CONDITION_LABELS[t.condition]} condition
                </p>
                {t.description && <p className="mt-2 line-clamp-2 text-sm text-stone-600">{t.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  Lent by {t.ownerName}
                  {t.ownerTrusted && <TrustedBadge />}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
