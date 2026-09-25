/**
 * The app reaches the same handler under /api/mobile/v1, where its client
 * (apps/mobile/lib/api.ts apiFetch) sends every request. One implementation,
 * two paths: the logic and its authorisation live in @/app/api/ads/campaigns/[id]/route.
 */
export { PATCH } from "@/app/api/ads/campaigns/[id]/route";
