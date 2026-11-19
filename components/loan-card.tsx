"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { LoanView } from "@/convex/loans";
import { formatRange, timeAgo } from "@/lib/format";
import { AutomationActivity } from "./automation-activity";
import { Card, StatusBadge } from "./ui";

export function LoanCard({
  loan,
  counterpartLabel,
  actions,
}: {
  loan: LoanView;
  counterpartLabel: string;
  actions?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {loan.toolRemoved ? (
              <span className="font-medium text-stone-500">{loan.toolName}</span>
            ) : (
              <Link href={`/tools/${loan.toolId}`} className="font-medium hover:underline">
                {loan.toolName}
              </Link>
            )}
            <StatusBadge status={loan.status} overdue={loan.overdue} />
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {formatRange(loan.startDate, loan.endDate)} · {counterpartLabel} {loan.otherPartyName}
          </p>
          <p className="mt-0.5 text-xs text-stone-400">Requested {timeAgo(loan.createdAt)}</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <AutomationActivity activity={loan.activity} />
    </Card>
  );
}
