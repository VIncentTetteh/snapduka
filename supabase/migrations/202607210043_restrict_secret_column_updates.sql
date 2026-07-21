-- supabase/migrations/202607210043_restrict_secret_column_updates.sql
-- outbound_webhooks.secret_encrypted and courier_connections.credentials_encrypted
-- were fully update-grantable to the owning seller via PostgREST, unlike the
-- equivalent social_accounts.access_token_sealed pattern (select+delete only).
-- Unlike that OAuth-derived token, these two values ARE legitimately
-- seller-authored at creation time (addWebhook inserts the seller's own
-- chosen signing secret) — so INSERT stays open, but no application code
-- ever updates either column after creation, so UPDATE is restricted here
-- to close a write path that doesn't need to exist.
--
-- Postgres column-level grants are additive on top of the table-level
-- grant, so we revoke table-level UPDATE (removing update rights on every
-- column) and re-grant UPDATE scoped to only the non-secret columns.

revoke update on public.outbound_webhooks from authenticated;
grant update (url, event_types, active) on public.outbound_webhooks to authenticated;

revoke update on public.courier_connections from authenticated;
grant update (provider, active) on public.courier_connections to authenticated;
