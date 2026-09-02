// @snapduka/core — framework-agnostic domain logic shared by the Next.js web app
// and the Expo mobile app. Pure TypeScript only: no React, no server-only imports.
export * from "./countries/types";
export * from "./countries/config";
export * from "./countries/phone";
export * from "./i18n";
export * from "./billing/entitlements";
export * from "./billing/subscriptions";
export * from "./billing/resolve";
export * from "./billing/tiers";
export * from "./auth/permissions";
export * from "./auth/actor";
export * from "./commerce/transitions";
export * from "./analytics/advanced";
export * from "./campaigns/tokens";
export * from "./share/channels";
export * from "./catalog/product-input";
export * from "./creators/commission";
export * from "./customers/segments";
export * from "./couriers/catalogue";
export * from "./payouts/balance";
export * from "./validation";
export * from "./theme/tokens";
export type { Database, Json } from "./supabase-types";
