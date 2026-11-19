"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { ToolForm } from "@/components/tool-form";
import { Badge, Button, Card, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/lib/format";
import { useAction } from "@/lib/useAction";

function ListingRow({ tool }: { tool: Doc<"tools"> }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [update, saving] = useAction(useMutation(api.tools.update), { success: "Listing updated" });
  const [remove, removing] = useAction(useMutation(api.tools.remove), { success: "Listing deleted" });

  if (editing) {
    return (
      <Card>
        <ToolForm
          initial={{
            name: tool.name,
            category: tool.category,
            condition: tool.condition,
            description: tool.description,
          }}
          submitLabel="Save changes"
          pending={saving}
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            const ok = await update({ toolId: tool._id, ...input });
            if (ok !== undefined) setEditing(false);
          }}
        />
      </Card>
    );
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <Link href={`/tools/${tool._id}`} className="font-medium hover:underline">
          {tool.name}
        </Link>
        <div className="mt-1 flex flex-wrap gap-2">
          <Badge>{CATEGORY_LABELS[tool.category]}</Badge>
          <Badge>{CONDITION_LABELS[tool.condition]}</Badge>
        </div>
      </div>
      <div className="flex gap-2">
        {confirming ? (
          <>
            <Button
              variant="danger"
              pending={removing}
              onClick={async () => {
                // Mutations resolve to null on success; undefined means it failed (toast shown).
                if ((await remove({ toolId: tool._id })) === undefined) setConfirming(false);
              }}
            >
              Confirm delete
            </Button>
            <Button variant="ghost" disabled={removing} onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

export default function MyListingsPage() {
  const tools = useQuery(api.tools.listMine);
  return (
    <>
      <PageHeader
        title="My listings"
        subtitle="Tools you're lending to the neighborhood."
        actions={
          <Link href="/tools/new" className="rounded-lg bg-brand-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-800">
            + List a tool
          </Link>
        }
      />
      {tools === undefined ? (
        <SkeletonList />
      ) : tools.length === 0 ? (
        <EmptyState title="You haven't listed anything yet" body="Lend a tool and help a neighbor out." action={{ href: "/tools/new", label: "List a tool" }} />
      ) : (
        <div className="space-y-3">
          {tools.map((t) => (
            <ListingRow key={t._id} tool={t} />
          ))}
        </div>
      )}
    </>
  );
}
