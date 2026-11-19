"use client";

import { useMutation, useQuery } from "convex/react";
import { LoanCard } from "@/components/loan-card";
import { Button, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { LoanView } from "@/convex/loans";
import { useAction } from "@/lib/useAction";

function RequestRow({ loan }: { loan: LoanView }) {
  const [cancel, pending] = useAction(useMutation(api.loans.cancel), { success: "Request cancelled" });
  return (
    <LoanCard
      loan={loan}
      counterpartLabel="from"
      actions={
        loan.status === "requested" && (
          <Button variant="secondary" pending={pending} onClick={() => cancel({ loanId: loan._id })}>
            Cancel request
          </Button>
        )
      }
    />
  );
}

export default function MyRequestsPage() {
  const loans = useQuery(api.loans.listMine);
  return (
    <>
      <PageHeader title="My requests" subtitle="Tools you've asked to borrow." />
      {loans === undefined ? (
        <SkeletonList />
      ) : loans.length === 0 ? (
        <EmptyState title="No requests yet" body="Find something you need and ask to borrow it." action={{ href: "/tools", label: "Browse tools" }} />
      ) : (
        <div className="space-y-3">
          {loans.map((l) => (
            <RequestRow key={l._id} loan={l} />
          ))}
        </div>
      )}
    </>
  );
}
