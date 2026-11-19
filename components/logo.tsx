import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-full bg-brand-700 text-sm text-white"
      >
        ↻
      </span>
      LendLoop
    </Link>
  );
}
