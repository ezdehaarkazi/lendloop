"use client";

import { useMutation, useQuery } from "convex/react";
import { LoanCard } from "@/components/loan-card";
import { Button, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { LoanView } from "@/convex/loans";
import { useAction } from "@/lib/useAction";

function IncomingRow({ loan }: { loan: LoanView }) {
  const [approve, approving] = useAction(useMutation(api.loans.approve), { success: "Request approved" });
  const [decline, declining] = useAction(useMutation(api.loans.decline), { success: "Request declined" });
  const [markReturned, returning] = useAction(useMutation(api.loans.markReturned), { success: "Marked as returned" });
  const busy = approving || declining || returning;
  const args = { loanId: loan._id };

  return (
    <LoanCard
      loan={loan}
      counterpartLabel="by"
      actions={
        <>
          {loan.status === "requested" && (
            <>
              <Button pending={approving} disabled={busy} onClick={() => approve(args)}>
                Approve
              </Button>
              <Button variant="danger" pending={declining} disabled={busy} onClick={() => decline(args)}>
                Decline
              </Button>
            </>
          )}
          {loan.status === "approved" && (
            <Button variant="secondary" pending={returning} disabled={busy} onClick={() => markReturned(args)}>
              Mark returned
            </Button>
          )}
        </>
      }
    />
  );
}

export default function IncomingPage() {
  const loans = useQuery(api.loans.listIncoming);
  const pending = loans?.filter((l) => l.status === "requested") ?? [];
  const active = loans?.filter((l) => l.status === "approved") ?? [];
  const past = loans?.filter((l) => l.status !== "requested" && l.status !== "approved") ?? [];

  return (
    <>
      <PageHeader title="Incoming requests" subtitle="Requests and loans on your tools." />
      {loans === undefined ? (
        <SkeletonList />
      ) : loans.length === 0 ? (
        <EmptyState title="No requests on your tools yet" body="When a neighbor asks to borrow something, it shows up here." />
      ) : (
        <div className="space-y-8">
          <Section title="Waiting for you" loans={pending} empty="Nothing waiting — you're all caught up." />
          <Section title="Out on loan" loans={active} empty="None of your tools are out right now." />
          {past.length > 0 && <Section title="History" loans={past} />}
        </div>
      )}
    </>
  );
}

function Section({ title, loans, empty }: { title: string; loans: LoanView[]; empty?: string }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
        {title} {loans.length > 0 && <span className="text-stone-400">({loans.length})</span>}
      </h2>
      {loans.length === 0 ? (
        <p className="text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="space-y-3">
          {loans.map((l) => (
            <IncomingRow key={l._id} loan={l} />
          ))}
        </div>
      )}
    </section>
  );
}
