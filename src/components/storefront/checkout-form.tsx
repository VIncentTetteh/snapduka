"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Method = { id: string; name: string; type: string; fee_minor: number; instructions: string };

export function CheckoutForm({
  shopId, country, product, methods,
}: {
  shopId: string;
  country: "GH" | "NG";
  product: { id: string; name: string; currency: string; price_minor: number };
  methods: Method[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const idempotencyKey = useMemo(() => `checkout-${crypto.randomUUID()}`, []);
  const input = "min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2";

  return (
    <form className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      setPending(true); setMessage("Placing your order...");
      const values = new FormData(event.currentTarget);
      const methodId = String(values.get("fulfillmentMethodId"));
      const method = methods.find((item) => item.id === methodId);
      const paymentMethod = method?.type === "pickup" ? "pay_on_pickup" : String(values.get("paymentMethod"));
      try {
        const response = await fetch("/api/checkout/orders", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            shopId, fulfillmentMethodId: methodId, idempotencyKey, paymentMethod,
            buyer: {
              name: values.get("name"), email: values.get("email"), phone: values.get("phone"), country,
              address: { line1: values.get("line1"), area: values.get("area"), city: values.get("city"), region: values.get("region") },
              marketingConsent: values.get("marketingConsent") === "on",
            },
            lines: [{ productId: product.id, quantity: Number(values.get("quantity")) }],
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (paymentMethod === "paystack") {
          const payment = await fetch("/api/payments/paystack/initialize", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId: result.orderId }),
          });
          const paymentResult = await payment.json();
          if (payment.ok && paymentResult.authorizationUrl) {
            window.location.href = paymentResult.authorizationUrl;
            return;
          }
        }
        router.push(`/orders/${result.trackingToken}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Connection failed. Your details are preserved; retry when online.");
      } finally { setPending(false); }
    }}>
      <section className="rounded-2xl border border-stone-300 bg-white p-4">
        <h2 className="m-0 text-xl font-extrabold">{product.name}</h2>
        <p>{product.currency} {(product.price_minor / 100).toFixed(2)}</p>
        <label className="font-bold" htmlFor="quantity">Quantity</label>
        <input className={input} defaultValue="1" id="quantity" inputMode="numeric" min="1" name="quantity" type="number" />
      </section>
      <section className="grid gap-3 rounded-2xl border border-stone-300 bg-white p-4">
        <h2 className="m-0 text-xl font-extrabold">Contact details</h2>
        <input className={input} autoComplete="name" name="name" placeholder="Full name" required />
        <input className={input} autoComplete="email" name="email" placeholder="Email" required type="email" />
        <input className={input} autoComplete="tel" name="phone" placeholder={country === "GH" ? "024 123 4567" : "0801 234 5678"} required />
        <input className={input} autoComplete="address-line1" name="line1" placeholder="Address line" />
        <input className={input} name="area" placeholder="Area" />
        <input className={input} autoComplete="address-level2" name="city" placeholder="City" />
        <input className={input} autoComplete="address-level1" name="region" placeholder={country === "GH" ? "Region" : "State"} />
      </section>
      <section className="grid gap-3 rounded-2xl border border-stone-300 bg-white p-4">
        <h2 className="m-0 text-xl font-extrabold">Receive your order</h2>
        {methods.map((method) => <label className="flex min-h-11 items-center gap-3" key={method.id}><input name="fulfillmentMethodId" required type="radio" value={method.id} /> <span><strong>{method.name}</strong><br />{product.currency} {(method.fee_minor / 100).toFixed(2)} · {method.instructions}</span></label>)}
        <select className={input} name="paymentMethod"><option value="paystack">Pay online with Paystack</option><option value="cash_on_delivery">Cash on delivery</option><option value="seller_arranged">Arrange payment with seller</option></select>
        <label className="flex min-h-11 items-center gap-2"><input name="marketingConsent" type="checkbox" /> Send me offers from this seller</label>
      </section>
      <p aria-live="polite" className="m-0">{message}</p>
      <button className="min-h-12 rounded-xl bg-emerald-900 px-4 text-lg font-extrabold text-white disabled:opacity-60" disabled={pending || methods.length === 0}>{pending ? "Placing order..." : "Place order"}</button>
    </form>
  );
}
