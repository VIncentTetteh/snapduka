import { ShareActions } from "@/components/storefront/share-actions";

export function ShopHeader({
  name,
  country,
  canonicalUrl,
  qrDataUrl,
}: {
  name: string;
  country: "GH" | "NG";
  canonicalUrl: string;
  qrDataUrl: string;
}) {
  return (
    <header className="grid gap-4 rounded-b-3xl bg-emerald-950 px-4 py-7 text-white">
      <p className="m-0 text-xs font-extrabold uppercase tracking-widest text-emerald-200">SnapDuka verified storefront</p>
      <h1 className="m-0 text-4xl font-black leading-none tracking-tight">{name}</h1>
      <p className="m-0 text-sm text-emerald-100">
        Seller-managed delivery and pickup · Prices in {country === "GH" ? "Ghana cedis" : "Nigerian naira"}
      </p>
      <ShareActions name={name} url={canonicalUrl} qrDataUrl={qrDataUrl} />
    </header>
  );
}
