"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartLine = { productId: string; variantId?: string | null; quantity: number };
type CartValue = {
  lines: CartLine[];
  add: (line: CartLine) => void;
  remove: (productId: string, variantId?: string | null) => void;
  setQuantity: (productId: string, variantId: string | null | undefined, quantity: number) => void;
  clear: () => void;
  checkoutHref: string;
  count: number;
  ready: boolean;
};
const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ shopSlug, children }: { shopSlug: string; children: ReactNode }) {
  const key = `snapduka:cart:${shopSlug}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "[]") as CartLine[];
      queueMicrotask(() => {
        setLines(saved.filter((line) => line.productId && Number.isInteger(line.quantity) && line.quantity > 0));
        setReady(true);
      });
    } catch {
      localStorage.removeItem(key);
      queueMicrotask(() => setReady(true));
    }
  }, [key]);

  const persist = useCallback((next: CartLine[]) => {
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  }, [key]);

  const value = useMemo(() => ({
    lines,
    add(line: CartLine) {
      setLines((current) => {
        const existing = current.find((item) => item.productId === line.productId && (item.variantId ?? null) === (line.variantId ?? null));
        const quantity = Math.min(99, (existing?.quantity ?? 0) + line.quantity);
        return persist([...current.filter((item) => item !== existing), { ...line, quantity }]);
      });
    },
    remove(productId: string, variantId?: string | null) {
      setLines((current) => persist(current.filter((item) => item.productId !== productId || (item.variantId ?? null) !== (variantId ?? null))));
    },
    setQuantity(productId: string, variantId: string | null | undefined, quantity: number) {
      setLines((current) => persist(current.map((item) => item.productId === productId && (item.variantId ?? null) === (variantId ?? null) ? { ...item, quantity: Math.max(1, Math.min(99, quantity)) } : item)));
    },
    clear() { localStorage.removeItem(key); setLines([]); },
    checkoutHref: `/${shopSlug}/checkout?cart=${encodeURIComponent(JSON.stringify(lines))}`,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    ready,
  }), [key, lines, persist, ready, shopSlug]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("CartProvider is required.");
  return value;
}
