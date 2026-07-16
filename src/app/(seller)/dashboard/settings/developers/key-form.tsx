"use client";

import { useActionState } from "react";

import { generateKey, type KeyState } from "./actions";

export function KeyForm() {
  const [state, action, pending] = useActionState(generateKey, {} as KeyState);

  return (
    <form action={action} className="card grid gap-3">
      <h2 className="m-0 text-lg font-extrabold" style={{ color: "var(--ink)" }}>API key</h2>
      <div className="grid gap-1">
        <label className="field-label" htmlFor="key-name">Key name</label>
        <input className="field-input" id="key-name" name="name" placeholder="Warehouse integration" />
      </div>
      <fieldset className="grid gap-2 rounded-xl p-3" style={{ border: "1.5px dashed var(--border)" }}>
        <legend className="field-label px-1">Scopes</legend>
        {["products:read", "orders:read", "customers:read", "fulfillment:write"].map((scope) => (
          <label className="flex items-center gap-2 text-sm" key={scope} style={{ color: "var(--ink)" }}>
            <input name="scope" type="checkbox" value={scope} />
            {scope}
          </label>
        ))}
      </fieldset>
      <button className="btn-primary w-full" disabled={pending} type="submit">
        {pending ? "Creating…" : "Create key"}
      </button>
      {state.error && (
        <div className="alert alert-error" role="alert">{state.error}</div>
      )}
      {state.token && (
        <div className="alert alert-warning">
          <strong>Copy now — it will not be shown again.</strong>
          <code className="mt-2 block break-all text-xs">{state.token}</code>
        </div>
      )}
    </form>
  );
}
