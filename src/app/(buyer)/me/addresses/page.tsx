import Link from "next/link";

import { ActionBanner } from "@/components/ui/action-banner";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { ADDRESS_COLUMNS, MAX_SAVED_ADDRESSES, type BuyerAddressRow } from "@/lib/buyer/addresses";
import { getBuyerSession } from "@/lib/buyer/session";

import { deleteAddressAction, saveAddressAction, setDefaultAddressAction } from "../account-actions";
import { CARD, INPUT, LABEL, PageTitle, PRIMARY, SECONDARY, SignInPrompt, first, type SearchParams } from "../shared";

function AddressForm({ address }: { address?: BuyerAddressRow }) {
  return (
    <form action={saveAddressAction} className="grid gap-3">
      {address ? <input type="hidden" name="id" value={address.id} /> : null}
      <input type="hidden" name="country" value={address?.country ?? "GH"} />
      <label className={LABEL}>
        <span>Label <span className="font-normal text-ink-muted">(optional, e.g. Home)</span></span>
        <input className={INPUT} name="label" maxLength={40} defaultValue={address?.label ?? ""} />
      </label>
      <label className={LABEL}>
        <span>Street, house or building</span>
        <input className={INPUT} name="line1" required maxLength={200} autoComplete="address-line1" defaultValue={address?.line1 ?? ""} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          <span>Area</span>
          <input className={INPUT} name="area" maxLength={100} defaultValue={address?.area ?? ""} />
        </label>
        <label className={LABEL}>
          <span>Town or city</span>
          <input className={INPUT} name="city" required maxLength={100} autoComplete="address-level2" defaultValue={address?.city ?? ""} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>
          <span>Region</span>
          <input className={INPUT} name="region" maxLength={100} autoComplete="address-level1" defaultValue={address?.region ?? ""} />
        </label>
        <label className={LABEL}>
          <span>GhanaPostGPS <span className="font-normal text-ink-muted">(optional)</span></span>
          <input className={INPUT} name="digitalAddress" maxLength={20} placeholder="GA-123-4567" defaultValue={address?.digital_address ?? ""} />
        </label>
      </div>
      <label className={LABEL}>
        <span>Landmark <span className="font-normal text-ink-muted">(what a rider should look for)</span></span>
        <input className={INPUT} name="landmark" maxLength={160} defaultValue={address?.landmark ?? ""} />
      </label>
      <SubmitButton className={PRIMARY} pendingLabel="Saving…">
        {address ? "Save changes" : "Add address"}
      </SubmitButton>
    </form>
  );
}

export default async function BuyerAddressesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const session = await getBuyerSession({ claimOnResolve: false });
  if (session.state !== "buyer") {
    return (
      <>
        <PageTitle title="Addresses" />
        <SignInPrompt />
      </>
    );
  }

  const { buyer, client } = session;
  const [{ data: addresses }, { data: profile }] = await Promise.all([
    client
      .from("buyer_addresses")
      .select(ADDRESS_COLUMNS)
      .eq("buyer_profile_id", buyer.buyerProfileId)
      .order("created_at", { ascending: false })
      .limit(MAX_SAVED_ADDRESSES),
    client.from("buyer_profiles").select("default_address_id").eq("id", buyer.buyerProfileId).maybeSingle(),
  ]);
  const rows = addresses ?? [];
  const editing = rows.find((row) => row.id === first(params.edit));

  return (
    <>
      <PageTitle title="Addresses" sub="Saved addresses fill in checkout at any SnapDuka shop. Shops only see the address you choose for their order." />
      <ActionBanner error={first(params.error)} saved={first(params.message)} />

      {rows.length > 0 ? (
        <ul className="mb-4 grid gap-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-[14px] border border-line bg-white p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-bold">{row.label ?? "Address"}</span>
                {profile?.default_address_id === row.id ? <Badge tone="success">Default</Badge> : null}
              </div>
              <p className="text-[13px] leading-[1.55] text-ink-soft">
                {[row.line1, row.area, row.city, row.region].filter(Boolean).join(", ")}
                {row.digital_address ? ` · ${row.digital_address}` : ""}
                {row.landmark ? <><br />{row.landmark}</> : null}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/me/addresses?edit=${row.id}`} className={SECONDARY}>
                  Edit
                </Link>
                {profile?.default_address_id !== row.id ? (
                  <form action={setDefaultAddressAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button type="submit" className={SECONDARY}>Make default</button>
                  </form>
                ) : null}
                <form action={deleteAddressAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <button type="submit" className={`${SECONDARY} text-danger`}>Remove</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <section className={CARD} aria-labelledby="address-form-heading">
        <h2 id="address-form-heading" className="mb-3 text-[15px] font-bold">
          {editing ? "Edit address" : "Add an address"}
        </h2>
        {rows.length >= MAX_SAVED_ADDRESSES && !editing ? (
          <p className="text-[13.5px] text-ink-soft">You have saved the maximum of {MAX_SAVED_ADDRESSES} addresses. Remove one to add another.</p>
        ) : (
          <AddressForm key={editing?.id ?? "new"} address={editing} />
        )}
      </section>
    </>
  );
}
