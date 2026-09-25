/**
 * Delivery-address readers live in @snapduka/core so the web order screen, the
 * courier booking path and the Expo app all read stored addresses the same
 * way. This is the web-side import path.
 */
export {
  deliveryAddressFromJson,
  deliveryMapUrl,
  formatDeliveryAddressLine,
  orderDeliveryAddress,
} from "@snapduka/core";
