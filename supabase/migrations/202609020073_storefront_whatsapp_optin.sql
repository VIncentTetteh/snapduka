-- supabase/migrations/202609020073_storefront_whatsapp_optin.sql
--
-- Give the storefront a WhatsApp number the seller has actually chosen to
-- publish.
--
-- The product page already told buyers "Questions? Message the seller on
-- WhatsApp before you buy" — as plain text, with no link and no number. On a
-- product whose whole positioning is WhatsApp-native commerce, the one place a
-- hesitant buyer looks for reassurance was a dead end.
--
-- seller_accounts.contact_phone already exists, but that is the seller's own
-- admin contact, not something to publish on a public page on their behalf.
-- This is a separate, explicitly opt-in field that is empty until the seller
-- fills it in, and the storefront shows the line only when it is set.
--
-- Stored on shop_branding rather than seller_accounts because it is a
-- storefront presentation choice, and it inherits that table's existing RLS:
-- owners write it, the public reads it as part of the storefront payload.

alter table public.shop_branding
  add column if not exists whatsapp_number text
    check (whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{7,14}$');

comment on column public.shop_branding.whatsapp_number is
  'E.164 number the seller chose to publish for buyer questions. Null means the storefront shows no WhatsApp line at all.';
