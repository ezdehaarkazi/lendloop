"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { SkeletonList } from "./ui";

/**
 * Renders children only once Convex has accepted the Clerk token AND the user
 * row exists, so authenticated queries never fire half-signed-in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");

  if (isLoading || (isAuthenticated && !me)) return <SkeletonList />;
  if (!isAuthenticated) {
    return (
      <p className="text-sm text-stone-600">
        Couldn&apos;t verify your session with the backend. Check the Clerk ↔ Convex setup in the
        README.
      </p>
    );
  }
  return <>{children}</>;
}
