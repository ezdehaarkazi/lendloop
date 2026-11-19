import type { LoanView } from "@/convex/loans";
import { timeAgo } from "@/lib/format";

const LABELS = {
  request_notification: "Notification",
  overdue_reminder: "Reminder",
} as const;

/** "Reminder sent 2 days ago" style trail of n8n write-backs for one loan. */
export function AutomationActivity({ activity }: { activity: LoanView["activity"] }) {
  if (activity.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-100 pt-2 text-xs text-stone-500" aria-label="Automation activity">
      {activity.map((a) => (
        <li key={`${a.type}-${a.at}`} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${a.status === "sent" ? "bg-brand-600" : "bg-red-500"}`}
          />
          {LABELS[a.type]} {a.status === "sent" ? "sent" : "failed"} {timeAgo(a.at)}
        </li>
      ))}
    </ul>
  );
}
