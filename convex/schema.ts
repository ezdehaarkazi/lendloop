import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vAutomationStatus,
  vAutomationType,
  vCategory,
  vCondition,
  vDeliveryStatus,
  vLoanStatus,
  vRole,
  vWebhookEvent,
} from "./lib/validators";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    email: v.string(),
    role: vRole,
    trustedLender: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
    createdAt: v.number(),
    // Soft delete: keeps loan history intact for both parties and admins.
    deletedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    // Denormalized from the tool so owner auth checks need no extra read.
    ownerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD (calendar day, UTC)
    endDate: v.string(), // YYYY-MM-DD inclusive
    status: vLoanStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool", ["toolId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_status_endDate", ["status", "endDate"]),

  automationEvents: defineTable({
    loanId: v.id("loans"),
    type: vAutomationType,
    idempotencyKey: v.string(),
    status: vAutomationStatus,
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  // Transactional outbox: written in the same mutation as the loan change,
  // delivered to n8n by a scheduled action with retries.
  webhookDeliveries: defineTable({
    loanId: v.id("loans"),
    event: vWebhookEvent,
    payload: v.string(), // exact JSON body that gets signed and sent
    attempts: v.number(),
    lastError: v.optional(v.string()),
    status: vDeliveryStatus,
    nextAttemptAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_loan", ["loanId"]),

  // Workflow-level failures reported by the n8n Error Workflow.
  automationErrors: defineTable({
    workflow: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    executionId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),
});
