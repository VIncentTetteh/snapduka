"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type CartLine = { productId: string; variantId?: string | null; quantity: number };
type CartValue = { lines: CartLine[]; add: (line: CartLine) => void; clear: () => void };
const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ shopSlug, children }: { shopSlug: string; children: ReactNode }) {
  const key = `snapduka:cart:${shopSlug}`;
  const [lines, setLines] = useState<CartLine[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
  });
  const value = useMemo(() => ({
    lines,
    add(line: CartLine) {
      setLines((current) => {
        const next = [...current.filter((item) => item.productId !== line.productId || item.variantId !== line.variantId), line];
        localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
    },
    clear() { localStorage.removeItem(key); setLines([]); },
  }), [key, lines]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("CartProvider is required.");
  return value;
}
