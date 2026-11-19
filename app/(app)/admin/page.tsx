"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader, SkeletonList, StatusBadge, TrustedBadge } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORY_LABELS, formatRange, timeAgo } from "@/lib/format";
import { useAction } from "@/lib/useAction";

const TABS = ["Listings", "Loans", "Users", "Automation"] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const me = useQuery(api.users.me);
  const [tab, setTab] = useState<Tab>("Listings");

  if (me === undefined) return <SkeletonList />;
  // UX only — every admin query/mutation re-checks the role server-side.
  if (me?.role !== "admin") return <EmptyState title="Admins only" body="You don't have access to this page." />;

  return (
    <>
      <PageHeader title="Admin" subtitle="Moderate listings, oversee loans and manage trust." />
      <div className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-stone-200 [scrollbar-width:none]" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? "border-brand-700 text-brand-800" : "border-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Listings" && <ListingsTab />}
      {tab === "Loans" && <LoansTab />}
      {tab === "Users" && <UsersTab />}
      {tab === "Automation" && <AutomationTab />}
    </>
  );
}

function ListingsTab() {
  const tools = useQuery(api.admin.listTools);
  if (tools === undefined) return <SkeletonList />;
  if (tools.length === 0) return <EmptyState title="No active listings" />;
  return (
    <div className="space-y-2">
      {tools.map((t) => (
        <AdminToolRow key={t._id} tool={t} />
      ))}
    </div>
  );
}

function AdminToolRow({
  tool,
}: {
  tool: { _id: Id<"tools">; name: string; category: keyof typeof CATEGORY_LABELS; ownerName: string; ownerTrusted: boolean };
}) {
  const [confirming, setConfirming] = useState(false);
  const [remove, pending] = useAction(useMutation(api.admin.removeTool), { success: "Listing removed" });
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">{tool.name}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
          {CATEGORY_LABELS[tool.category]} · {tool.ownerName} {tool.ownerTrusted && <TrustedBadge />}
        </p>
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <Button variant="danger" pending={pending} onClick={() => remove({ toolId: tool._id })}>
            Remove listing
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Remove
        </Button>
      )}
    </Card>
  );
}

function LoansTab() {
  const loans = useQuery(api.admin.listLoans);
  if (loans === undefined) return <SkeletonList />;
  if (loans.length === 0) return <EmptyState title="No loans yet" />;
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-4 py-2">Tool</th>
            <th className="px-4 py-2">Borrower</th>
            <th className="px-4 py-2">Owner</th>
            <th className="px-4 py-2">Dates</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {loans.map((l) => (
            <tr key={l._id}>
              <td className="px-4 py-2 font-medium">{l.toolName}</td>
              <td className="px-4 py-2">{l.borrowerName}</td>
              <td className="px-4 py-2">{l.ownerName}</td>
              <td className="px-4 py-2 whitespace-nowrap">{formatRange(l.startDate, l.endDate)}</td>
              <td className="px-4 py-2">
                <StatusBadge status={l.status} overdue={l.overdue} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersTab() {
  const users = useQuery(api.admin.listUsers);
  if (users === undefined) return <SkeletonList />;
  return (
    <div className="space-y-2">
      {users.map((u) => (
        <UserRow key={u._id} user={u} />
      ))}
    </div>
  );
}

function UserRow({
  user,
}: {
  user: { _id: Id<"users">; name: string; email: string; role: "admin" | "user"; trustedLender: boolean };
}) {
  const [setTrusted, pending] = useAction(useMutation(api.admin.setTrustedLender), {
    success: user.trustedLender ? "Trusted Lender removed" : "Marked as Trusted Lender",
  });
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {user.name} {user.role === "admin" && <Badge tone="blue">Admin</Badge>} {user.trustedLender && <TrustedBadge />}
        </p>
        <p className="text-sm text-stone-500">{user.email}</p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-brand-700"
          checked={user.trustedLender}
          disabled={pending}
          onChange={(e) => setTrusted({ userId: user._id, trusted: e.target.checked })}
        />
        Trusted Lender
      </label>
    </Card>
  );
}

function AutomationTab() {
  const health = useQuery(api.admin.automationHealth);
  const [retry, retrying] = useAction(useMutation(api.admin.retryDelivery), { success: "Retry scheduled" });
  const [dismiss, dismissing] = useAction(useMutation(api.admin.dismissError), { success: "Error dismissed" });
  if (health === undefined) return <SkeletonList />;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Failed webhook deliveries</h2>
        {health.failed.length === 0 ? (
          <p className="text-sm text-stone-500">None — every notification reached n8n.</p>
        ) : (
          <div className="space-y-2">
            {health.failed.map((d) => (
              <Card key={d._id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {d.event} <span className="text-xs text-stone-500">· {d.attempts} attempts · {timeAgo(d.createdAt)}</span>
                  </p>
                  <p className="truncate font-mono text-xs text-red-700">{d.lastError}</p>
                </div>
                <Button variant="secondary" pending={retrying} onClick={() => retry({ deliveryId: d._id })}>
                  Retry
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Pending (retrying)</h2>
        {health.pending.length === 0 ? (
          <p className="text-sm text-stone-500">Queue is empty.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {health.pending.map((d) => (
              <li key={d._id}>
                {d.event} · attempt {d.attempts + 1} · next {timeAgo(d.nextAttemptAt)}
                {d.lastError && <span className="ml-2 font-mono text-xs text-amber-700">{d.lastError}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">n8n workflow errors</h2>
        {health.errors.length === 0 ? (
          <p className="text-sm text-stone-500">No workflow errors reported.</p>
        ) : (
          <div className="space-y-2">
            {health.errors.map((e) => (
              <Card key={e._id} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {e.workflow}
                    {e.node && <span className="text-stone-500"> → {e.node}</span>}
                    <span className="ml-2 text-xs text-stone-400">{timeAgo(e.createdAt)}</span>
                  </p>
                  <p className="font-mono text-xs break-words text-red-700">{e.message}</p>
                </div>
                <Button variant="ghost" pending={dismissing} onClick={() => dismiss({ errorId: e._id })}>
                  Dismiss
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
