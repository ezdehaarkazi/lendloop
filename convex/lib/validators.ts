import { v, type Infer } from "convex/values";

export const CATEGORIES = [
  "power_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;

export const CONDITIONS = ["new", "good", "fair", "worn"] as const;

export const LOAN_STATUSES = [
  "requested",
  "approved",
  "declined",
  "returned",
  "cancelled",
] as const;

export const vCategory = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const vCondition = v.union(...CONDITIONS.map((c) => v.literal(c)));
export const vLoanStatus = v.union(...LOAN_STATUSES.map((s) => v.literal(s)));
export const vRole = v.union(v.literal("admin"), v.literal("user"));
export const vAutomationType = v.union(
  v.literal("request_notification"),
  v.literal("overdue_reminder"),
);
export const vAutomationStatus = v.union(v.literal("sent"), v.literal("failed"));
export const vDeliveryStatus = v.union(
  v.literal("pending"),
  v.literal("delivered"),
  v.literal("failed"),
);
export const vWebhookEvent = v.union(
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.returned"),
  v.literal("loan.cancelled"),
);

export type Category = Infer<typeof vCategory>;
export type Condition = Infer<typeof vCondition>;
export type LoanStatus = Infer<typeof vLoanStatus>;
export type WebhookEvent = Infer<typeof vWebhookEvent>;
export type AutomationType = Infer<typeof vAutomationType>;

export const LIMITS = {
  toolNameMax: 80,
  descriptionMax: 280,
  maxLoanDays: 30,
} as const;
