# SnapDuka APIs, Webhooks, and Automation Design

## Scope

Provide public seller APIs, outbound webhooks, accounting or operational
integration foundations, and advanced event-driven automation.

## Architecture

Personal API keys are hashed at rest, scoped, seller-bound, prefix-identifiable,
rotatable, and shown only once. Versioned `/api/v1` endpoints expose catalog,
orders, customers, and fulfillment according to scopes and team permissions.
Cursor pagination and request identifiers are mandatory.

Outbound webhook endpoints subscribe to explicit event types. Deliveries use
HMAC signatures, timestamp headers, idempotency IDs, exponential retry, and a
dead-letter state. Payloads contain seller-owned data only.

Automation rules use `trigger`, optional structured conditions, and constrained
actions. Initial actions are tag customer, enqueue notification, create private
note, and call an outbound webhook. Rules cannot mutate payments or bypass
consent, entitlements, or authorization.

## Data Model

- `api_keys`, `api_request_logs`
- `webhook_endpoints`, `webhook_deliveries`, `webhook_attempts`
- `automation_rules`, `automation_runs`, `automation_action_results`
- `integration_connections`, `integration_sync_runs`

## Failure Handling

Revoked or expired keys fail immediately. Rate limits are seller and key
scoped. Webhook receiver failures retry without affecting source transactions.
Automation execution is idempotent per rule/event. Recursive automation is
blocked by origin metadata and depth limits.

## Acceptance

Tests prove key secrecy and scopes, pagination, rate limits, tenant isolation,
signature verification, endpoint disablement, retries/dead letters, automation
idempotency, recursion prevention, consent enforcement, and auditability.
