import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, eventForStatus, isTerminal } from "./loanState";
import { LOAN_STATUSES, type LoanStatus } from "./validators";

const allowed: Array<[LoanStatus, LoanStatus]> = [
  ["requested", "approved"],
  ["requested", "declined"],
  ["requested", "cancelled"],
  ["approved", "returned"],
];

describe("loan state machine", () => {
  it.each(allowed)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it("rejects every transition not explicitly allowed", () => {
    for (const from of LOAN_STATUSES) {
      for (const to of LOAN_STATUSES) {
        const ok = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(ok);
        if (!ok) expect(() => assertTransition(from, to)).toThrow(/Cannot change/);
      }
    }
  });

  it("treats declined, returned and cancelled as terminal", () => {
    expect(LOAN_STATUSES.filter(isTerminal)).toEqual(["declined", "returned", "cancelled"]);
  });

  it("maps statuses to webhook events", () => {
    expect(eventForStatus("approved")).toBe("loan.approved");
  });
});
