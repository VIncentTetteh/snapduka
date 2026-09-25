import { deliveryMapUrl, type DeliveryAddress } from "@snapduka/core";

/**
 * The courier-grade parts of a buyer's address — GhanaPostGPS code, landmark
 * and map pin — for the seller's order screen. Renders nothing when the buyer
 * gave none of them, which is most orders, so the classic address line above
 * it stays the whole story.
 */
export function DeliveryAddressDetails({ address }: { address: DeliveryAddress | null }) {
  if (!address) return null;
  const mapUrl = deliveryMapUrl(address);
  if (!address.digitalAddress && !address.landmark && !mapUrl) return null;

  return (
    <div className="grid gap-1 text-[13px] text-ink-soft">
      {address.digitalAddress ? (
        <p className="m-0">
          <span className="text-ink-muted">GhanaPostGPS: </span>
          <span className="font-semibold tracking-wide text-ink">{address.digitalAddress}</span>
        </p>
      ) : null}
      {address.landmark ? (
        <p className="m-0">
          <span className="text-ink-muted">Landmark: </span>
          {address.landmark}
        </p>
      ) : null}
      {mapUrl ? (
        <a href={mapUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent">
          Open the buyer&apos;s pin in Maps
        </a>
      ) : null}
    </div>
  );
}
