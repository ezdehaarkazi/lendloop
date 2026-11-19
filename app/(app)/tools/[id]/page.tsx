"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge, Button, Card, EmptyState, SkeletonList, TrustedBadge } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { LIMITS } from "@/convex/lib/validators";
import { CATEGORY_LABELS, CONDITION_LABELS, addDays, formatRange, todayUtc } from "@/lib/format";
import { useAction } from "@/lib/useAction";

const inputClass =
  "mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none";

/** Client-side mirror of the server rules — for instant feedback only. */
function rangeProblem(start: string, end: string, booked: Array<{ startDate: string; endDate: string }>) {
  const today = todayUtc();
  if (!start || !end) return "Pick a start and end date.";
  if (start < today) return "Start date can't be in the past.";
  if (end < start) return "End date must be on or after the start date.";
  if (end > addDays(start, LIMITS.maxLoanDays - 1)) return `Loans can be at most ${LIMITS.maxLoanDays} days.`;
  if (booked.some((b) => start <= b.endDate && b.startDate <= end)) return "Those dates overlap an existing loan.";
  return null;
}

export default function ToolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const tool = useQuery(api.tools.get, { toolId: id });
  const [request, pending] = useAction(useMutation(api.loans.request), { success: "Request sent to the owner" });

  const today = todayUtc();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 2));

  if (tool === undefined) return <SkeletonList rows={2} />;
  if (tool === null) {
    return <EmptyState title="Tool not found" body="It may have been removed." action={{ href: "/tools", label: "Back to browse" }} />;
  }

  const problem = rangeProblem(start, end, tool.booked);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem || !tool) return;
    if (await request({ toolId: tool._id, startDate: start, endDate: end })) router.push("/me/requests");
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div>
        <Link href="/tools" className="text-sm text-stone-500 hover:underline">
          ← All tools
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{tool.name}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge>{CATEGORY_LABELS[tool.category]}</Badge>
          <Badge>{CONDITION_LABELS[tool.condition]} condition</Badge>
        </div>
        {tool.description && <p className="mt-4 whitespace-pre-line text-stone-700">{tool.description}</p>}
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-stone-500">
          Lent by {tool.ownerName} {tool.ownerTrusted && <TrustedBadge />}
        </p>
        {tool.booked.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-stone-700">Already booked</h2>
            <ul className="mt-2 space-y-1 text-sm text-stone-600">
              {tool.booked.map((b) => (
                <li key={b.startDate}>{formatRange(b.startDate, b.endDate)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Card className="h-fit">
        {tool.isMine ? (
          <p className="text-sm text-stone-600">
            This is your tool. Manage it from{" "}
            <Link href="/me/listings" className="text-brand-700 underline">
              My listings
            </Link>
            .
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="font-medium">Request to borrow</h2>
            <label className="block text-sm font-medium">
              From
              <input type="date" className={inputClass} value={start} min={today} onChange={(e) => setStart(e.target.value)} required />
            </label>
            <label className="block text-sm font-medium">
              Until (inclusive)
              <input
                type="date"
                className={inputClass}
                value={end}
                min={start || today}
                max={start ? addDays(start, LIMITS.maxLoanDays - 1) : undefined}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </label>
            {problem && <p className="text-sm text-red-600" role="alert">{problem}</p>}
            <Button type="submit" className="w-full" pending={pending} disabled={!!problem}>
              Send request
            </Button>
            <p className="text-xs text-stone-500">The owner will be notified and can approve or decline.</p>
          </form>
        )}
      </Card>
    </div>
  );
}
