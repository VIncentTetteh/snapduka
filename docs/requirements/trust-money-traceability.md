# Trust-and-Money Traceability

Requirements added with the trust-and-money release (PRD sections 6.14 and 6.15)
mapped to their implementation and verification. Rows are added when the work
exists, never ahead of it.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| PRT-001 | `set_order_protection` (202609250106), `/api/orders/[token]/protect`, checkout Protect option | pgTAP 050, `protect/route.test.ts`, `checkout-form.protect.test.tsx` |
| PRT-002 | `guard_protected_order`, `stamp_order_fulfilled_at`, `capture_order_settlement` (202609250106), `transitionOrder` / `advanceFulfillment` Protect checks | pgTAP 050, `transition`/`fulfillment` tests |
| PRT-003 | `issue_delivery_code` + dispatch trigger (202609250107), `protect.code_issued` SMS handler with redaction, tracking-page code rotation | pgTAP 050, `protect/handlers.test.ts`, `delivery/route.test.ts` |
| PRT-004 | `confirm_delivery` lockout, `/d/[riderToken]`, `/api/protect/rider/[riderToken]` | pgTAP 050, `rider/[riderToken]/route.test.ts` |
| PRT-005 | `protect_mark_delivered` inspection window, `ProtectPanel` "I have received my order" | pgTAP 050, `delivery/route.test.ts` |
| PRT-006 | `open_protect_dispute_from_case`, `resolve_protect_dispute` (202609250108), admin case Protect panel, `protect.refund_requested` → `startRefund` | pgTAP 050, `admin/protect-actions.test.ts`, `protect/handlers.test.ts` |
| PRT-007 | `protect_sweep`, `record_courier_delivery` (202609250107), `/api/internal/protect/sweep` on pg_cron | pgTAP 050 |
| PRT-008 | `country_configs.protect_*`, `protect` flag, float and order caps in `set_order_protection` | pgTAP 050, `protect/route.test.ts` |
| PAY-014 | `payment_disputes`, `apply_paystack_dispute_event` (202609250109), webhook `charge.dispute.*` | pgTAP 050, `paystack/webhook/route.test.ts` |
| PAY-015 | `write_off_seller_debt` (202609250109), admin seller write-off | pgTAP 050, `admin/protect-actions.test.ts` |
| PAY-016 | `request_seller_payout(bigint,text,text)`, `claim_payout_for_transfer` not_before gate (202609250110), payout speed selector | pgTAP 051, execute worker tests |
| PAY-017 | `seller_accounts.settlement_mode_override`, `seller_settlement_mode`, `record_ledger_reconciliation` enforced flag | pgTAP 050, reconcile worker |
| PAY-018 | `provider_health`, `record_payment_outcome` (202609250111), `payments/providers/{registry,router}.ts`, initialize fallback | pgTAP 052, `router.test.ts`, `initialize/route.test.ts` |
| PAY-019 | `/api/exports/wallet-statement`, `lib/payouts/statement.ts` | `statement.test.ts` |
| OPS-010 | `admin_north_star` (202609250112), admin overview panel | admin build and SQL |
| PLT-001 | `feature_flags`, `evaluate_feature_flag` (202609250102), `lib/flags.ts`, core `FLAG_KEYS` | pgTAP 049, `flags.test.ts` |
| PLT-002 | `domain_events`, `emit/claim/complete_domain_event` (202609250103), `/api/internal/events/process` | `events/process.test.ts`, pgTAP 050 (events emitted) |
| PLT-003 | `@sentry/nextjs` instrumentation, `lib/observability/{scrub,sampling,cron}.ts` | observability tests |
| PLT-004 | core `i18n/messages/{en,fr,pcm,tw}.ts`, `icu-lite.ts`, `scripts/check-i18n.mjs` | core i18n tests, `i18n:check` in CI |
| PLT-005 | `scripts/gen-tokens.mjs`, generated `@theme` block | `tokens:check` in CI |
| BYR-001 | `buyer_profiles`, `bootstrap_buyer_profile` (202609250170), `/me` sign-in | pgTAP 070/071, buyer tests |
| BYR-002 | `claim_guest_orders`, `link_order_to_buyer`, checkout route `after()` link | pgTAP 071, `checkout/orders/route.test.ts` |
| BYR-003 | `/me/orders` keyset-paged | buyer page tests |
| BYR-004 | `buyer_addresses`, `/me/addresses`, `buyer-checkout-prefill.tsx` | pgTAP 070, prefill tests |
| BYR-005 | owner-only RLS, `/me/privacy` export and erasure, ADR-0007 | pgTAP 070 isolation assertions |
| WAC-001 | `lib/notifications/whatsapp.ts` Cloud API sender, `wa_templates` (202609250121), `sendDeliveryCodeWhatsApp` used by the Protect code handler | pgTAP 061, whatsapp tests, `protect/handlers.test.ts` |
| WAC-002 | `/api/whatsapp/webhook`, `wa_record_inbound` (202609250122), `lib/whatsapp/agent/**` guardrails, `scripts/eval-wa-agent.mjs` | pgTAP 062, agent tests, eval harness |
| WAC-003 | `/dashboard/inbox`, `/api/mobile/v1/inbox/**` | inbox route tests |
| WAC-004 | `seller_digest_due`/`seller_digest_summary` (202609250123), `/api/internal/whatsapp/digest` | pgTAP 063, digest tests |
| AIL-001 | `lib/ai/listing-draft.ts`, `/api/mobile/v1/ai/listing-draft`, `suggest_price` (202609250120), create-product "Draft from photo" | pgTAP 060, listing-draft tests |
| AIL-002 | `lib/ai/captions.ts`, `suggestCaptionsAction`, Share Studio suggestions | caption tests |
| AIL-003 | `ai_runs`, `ai_spend_this_month` (202609250120), `lib/ai/client.ts` budget gate | pgTAP 060, client tests |
| DLV-001 | `packages/core/src/couriers/adapter.ts`, `lib/couriers/{registry,adapters/*}`, adapter-aware courier webhook | adapter contract tests, `couriers/webhook` tests |
| DLV-002 | `lib/couriers/aggregate.ts` `quoteDelivery`, `/api/delivery/quote`, `delivery_margin_bps` (202609250140) | pgTAP 065, aggregate tests |
| DLV-003 | core `addresses/*`, `orders.delivery_address` (202609250142), checkout `delivery-address-extras` | pgTAP 066, address tests |
| DLV-004 | `shop_pickup_addresses` (202609250141), fulfilment settings pickup form | pgTAP 066, `settings/fulfillment/actions.test.ts` |
| TRS-001 | `kyc_checks`, `start_kyc_check`/`apply_kyc_result` (202609250143), `lib/kyc/**`, `/dashboard/settings/verification`, `/api/kyc/webhook/[provider]` | pgTAP 067, KYC tests |
| TRS-002 | `seller_trust_scores`, `compute_seller_trust_scores` (202609250144), storefront badge, instant-payout tier gate | pgTAP 068, pgTAP 051 |
| TRS-003 | `risk_signals` engine (202609250145), `lib/risk/{signals,engine,schedule}.ts` | pgTAP 069, risk tests |
| CRT-001 | creator ledger kinds and accounts (202609250200–0203), `post_creator_commission_accrual`, `release_creator_commission`, `request_creator_payout`, creator portal wallet, mobile creator payments, `creator_wallet_available` notification (202609250291) | pgTAP 080, 081, creator wallet tests |
| FIN-001 | `financing_policies`/`offers`/`advances`/`sweeps`, `financing_eligibility`, repayment sweep job (202609250221, 0223), `/dashboard/capital`, financing notifications handler | pgTAP 085, 086, financing tests |
| FIN-002 | `src/lib/bnpl/**`, BNPL route in payment router, `partner_clearing` capture and refund (202609250290), BNPL refunds via partner | pgTAP 054, bnpl tests, `refunds.test.ts` |
| FIN-003 | `ad_campaigns`/`ad_clicks`, `sponsored_listings`, `record_ad_click` (202609250222), Discover sponsored section, `/dashboard/ads` | pgTAP 087, 088, ads tests |
| DLV-005 | `courier_booking_billable`, `charge_courier_booking`, `settle_courier_payable` (202609250191–0192), booking guard, admin courier payable panel | pgTAP 053, booking tests |
| OPS-011 | `sms_opt_outs`, `sms_apply_opt_keyword` (202609250260), `/api/sms/inbound/[provider]`, marketing SMS footer and suppression, `/admin/sms-opt-outs` | pgTAP 095, SMS tests |
| OPS-012 | `whatsapp_platform_secrets` (202609250261), `lib/whatsapp/vault.ts` | pgTAP 096, WhatsApp tests |
| OPS-013 | admin aggregates (202609250240), keyset cursors `lib/api/keyset-cursor.ts` for `/api/v1/{orders,customers,products}` | pgTAP 090, `list-routes.test.ts` |
| OPS-014 | `warehouse` views and `warehouse_pub` (202609250242), `warehouse/` dbt project, funnel events (202609250241) | pgTAP 091–093, `check_models.py --verify` |
| CAT-012 | `set_product_category` and policies (202609250263), product form category picker (web and mobile) | pgTAP 098, product action tests |
