"use client";

import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Logo } from "./logo";

const LINKS = [
  { href: "/tools", label: "Browse" },
  { href: "/me/listings", label: "My listings" },
  { href: "/me/requests", label: "My requests" },
  { href: "/me/incoming", label: "Incoming" },
];

/** Creates/refreshes the Convex user row once the Clerk token is accepted. */
function useStoreUser() {
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  useEffect(() => {
    if (isAuthenticated) void store({});
  }, [isAuthenticated, store]);
}

export function AppNav() {
  useStoreUser();
  const pathname = usePathname();
  const me = useQuery(api.users.me);
  const [open, setOpen] = useState(false);
  const links = me?.role === "admin" ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;

  const linkClass = (href: string) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      pathname.startsWith(href) ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100"
    }`;

  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Logo href="/tools" />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l.href)}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md p-2 text-stone-600 hover:bg-stone-100 md:hidden"
            aria-expanded={open}
            aria-label="Toggle menu"
            onClick={() => setOpen((o) => !o)}
          >
            ☰
          </button>
          <UserButton />
        </div>
      </div>
      {open && (
        <nav className="flex flex-col gap-1 border-t border-stone-100 px-4 py-2 md:hidden" aria-label="Mobile">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l.href)} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
