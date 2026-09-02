/**
 * The order state machine lives in @snapduka/core so the web dashboard and the
 * Expo app cannot disagree about which buttons an order may show. This module
 * stays as the web-side import path — every existing call site keeps working.
 *
 * Note for callers: this file must stay free of `server-only` imports. Client
 * components and route adapters import these guards, and pulling in the admin
 * client transitively would break both.
 */
export {
  canTransitionOrder,
  fulfillmentForTransition,
  isSellerTransition,
  SELLER_TRANSITIONS,
  type OrderState,
  type SellerTransition,
} from "@snapduka/core";
