# Taking LendLoop to production

This note covers what I would change before real neighbors use LendLoop. Items are grouped by area and ordered by priority within each group.

## 1. n8n runtime

- **Managed or hardened n8n.** Use n8n Cloud, or self-host in **queue mode**: a main instance, workers, Redis (BullMQ) and Postgres instead of SQLite. Queue mode lets webhook intake scale independently of execution and survives a worker crash mid-run.
- **External task runners** (`N8N_RUNNERS_MODE=external`) so Code nodes run in a separate, resource-limited container.
- **Stop reading secrets from `$env`.** Today the Code nodes read the HMAC secret via `$env` (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). In production I'd re-enable the block and load the secret through **n8n External Secrets** (AWS Secrets Manager / Vault), or move signing into a small custom node that uses a typed credential.
- **Pin and patch.** Pin the image digest, not just the tag, and track n8n security advisories with a monthly upgrade window.
- **Git-backed workflows.** Use n8n Source Control (environments) for promotion, with `pnpm check:secrets` as a required CI check on that repo.

## 2. Secrets

- Keep secrets in **AWS Secrets Manager**, Doppler, or Vault, injected at deploy time. Convex env vars are set from CI, not by hand.
- **Rotation without downtime for `N8N_WEBHOOK_SECRET`.** Support two active keys (`current` and `previous`) and send a key id header (`X-LendLoop-Key-Id`). Verifiers accept either key during the rotation window. Rotate quarterly, and immediately on suspected leak.
- Use separate secrets per direction (Convex → n8n and n8n → Convex) and per environment.

## 3. Edge & abuse protection

- **Rate limiting:**
  - On the Convex HTTP endpoints. A token bucket keyed by IP and route works, e.g. via `@convex-dev/rate-limiter`. Only n8n should ever call them; behind a static egress IP they can also be IP-allowlisted.
  - On the n8n webhook at the edge (CloudFront + AWS WAF rate-based rules).
- **Per-user mutation limits** to stop request spam (e.g. at most N pending requests per borrower, X new listings per day). Add **bot protection** on sign-up (Clerk has it built in).
- Add a **CSP** header and HSTS. Basic security headers are already set in `next.config.ts`.

## 4. Observability

- **Errors: Sentry** for the Next.js client and server and for Convex functions (Convex has a Sentry integration). Correlate events by `loanId` / delivery id.
- **Logs and metrics: Datadog** (or Axiom), via Convex log streams and n8n container logs. Dashboards and alerts on:
  - outbox: pending count, age of the oldest pending row, and the failed (dead-letter) count. Alert on DLQ > 0 or oldest pending > 15 min;
  - webhook latency and status distribution;
  - Workflow B: "did it run today?". Alert if no `overdue_reminder` events by 09:30 UTC on a day with overdue loans;
  - `401` rate on the signed endpoints, which signals probing or clock skew.
- **Tracing**: send a `traceparent` header with webhooks so a request can be followed from Convex through n8n to SMTP.

## 5. Reliability & dead letters

- **Dead-letter handling**: today failed deliveries sit in `webhookDeliveries` with an admin Retry button. In production:
  - page on-call when the DLQ is non-empty;
  - add a bulk "retry all" action;
  - auto-retry the DLQ once after n8n recovers (health-check gated);
  - set a TTL with archival to S3.
- **Idempotency in n8n too**: dedupe on `deliveryKey` in Workflow A (Redis or Postgres lookup) before sending, so an n8n timeout followed by a Convex retry can never produce a second email.
- **Email provider**: SES or Postmark with SPF/DKIM/DMARC, and bounce and complaint webhooks that write back to Convex (suppress future emails to hard-bounced addresses).
- **Load tests** on request and approve under contention to confirm Convex's OCC retries behave well.

## 6. Data, audit & backups

- **Audit log table**: an append-only record of who did what and when (admin removals, trust toggles, role changes, status transitions), written in the same transaction and shown to admins.
- **Backups**: enable scheduled Convex backups (daily, 30-day retention) plus periodic `npx convex export` to an encrypted S3 bucket with Object Lock. Back up the n8n Postgres database and the encryption key separately, and **test restores** quarterly.
- **Scale**: paginate list queries, denormalize "on loan now" onto `tools` (updated on approve/return), and replace the `.collect()` scans with indexed range queries.

## 7. AWS deployment path

```
Route 53 ─▶ CloudFront (+WAF) ─┬─▶ Vercel / Amplify (Next.js)        app.lendloop.example
                               └─▶ ALB ─▶ ECS Fargate (n8n)           hooks.lendloop.example
                                         ├─ n8n main  (webhooks, UI behind SSO/VPN)
                                         ├─ n8n workers (autoscaling on queue depth)
                                         ├─ ElastiCache Redis (queue)
                                         └─ RDS Postgres (multi-AZ, encrypted)
Convex Cloud (prod deployment) ─ HTTP actions at *.convex.site
Secrets Manager → ECS task env / n8n external secrets;  SES for email
```

- **Next.js** on Vercel is simplest. For an all-AWS setup, use Amplify Hosting or OpenNext on Lambda behind CloudFront.
- **n8n on ECS Fargate**:
  - private subnets; the ALB exposes **only** `/webhook/*` publicly;
  - the editor UI sits behind SSO (Cognito/ALB OIDC) or a VPN;
  - a NAT gateway with a static egress IP, so the Convex endpoints can allowlist it.
- **Infrastructure as code**: Terraform or CDK. Run blue/green deploys for the n8n main instance and rolling deploys for workers.

## 8. Privacy & compliance

- **GDPR/CCPA**:
  - a published privacy notice;
  - a lawful basis for notification emails (contract) and opt-outs for reminder frequency;
  - a **data export** and **account deletion** flow. A Clerk `user.deleted` webhook would anonymize the `users` row and cascade to tools and loans while keeping aggregate history.
- **Data minimization stays the default**: email payloads already carry first name + email + tool + dates only. Keep n8n execution retention short (already 7 days, with success data off for Workflow A) and turn off "save manual executions" in production.
- **Processor agreements (DPAs)** with Clerk, Convex, the email provider and AWS. Document sub-processors and data residency (pick the Convex and Clerk regions to match the users).
- **Retention policy**: purge or anonymize loans older than N months, and expire `webhookDeliveries` and `automationEvents` after 90 days.
- **Accessibility audit** (WCAG 2.2 AA) and an abuse/report flow for listings.
