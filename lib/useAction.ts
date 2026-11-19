"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "./format";

/**
 * Wraps an async call with a pending flag and success/error toasts so every
 * button in the app behaves the same way (disabled while mutating).
 */
export function useAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  messages: { success?: string } = {},
) {
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      try {
        const result = await fn(...args);
        if (messages.success) toast.success(messages.success);
        return result;
      } catch (err) {
        toast.error(errorMessage(err));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn, messages.success],
  );
  return [run, pending] as const;
}
