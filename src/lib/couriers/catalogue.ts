/**
 * The courier catalogue lives in @snapduka/core: the Expo app renders the
 * picker from it and this app validates against it, so a single definition is
 * the only way the two cannot disagree about what a valid courier is.
 *
 * This module stays as the web-side import path — every existing call site,
 * including the zod refinement in api/couriers/book, is untouched.
 */
export {
  courierLabel,
  courierOptions,
  isCourierKey,
  requiresCustomName,
  type CourierKey,
  type CourierOption,
} from "@snapduka/core";
