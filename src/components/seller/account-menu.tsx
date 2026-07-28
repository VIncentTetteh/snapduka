"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { InitialsAvatar } from "@/components/ui/gradient-placeholder";
import { SignOutForm } from "@/components/ui/sign-out-form";

const ITEM_CLASSES =
  "block w-full cursor-pointer rounded-[8px] border-none bg-transparent px-2.5 py-2 text-left text-[13.5px] font-medium text-ink-soft no-underline transition-colors hover:bg-line-soft hover:text-ink";

/**
 * Avatar button that opens the account menu holding Settings and Sign out.
 *
 * The avatar used to be a bare link to settings, which left the app with no
 * way to end a session at all.
 */
export function AccountMenu({ ownerName, shopName }: { ownerName: string; shopName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const pathname = usePathname();

  // Stores which route the menu was opened on rather than a bare boolean, so
  // navigating away closes it as derived state — no effect syncing on pathname.
  const [openForPath, setOpenForPath] = useState<string | null>(null);
  const open = openForPath === pathname;
  const setOpen = (next: boolean) => setOpenForPath(next ? pathname : null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpenForPath(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenForPath(null);
      // Return focus to the trigger so keyboard users are not dropped at the
      // top of the document.
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="cursor-pointer rounded-full border-none bg-transparent p-0"
        onClick={() => setOpen(!open)}
        ref={triggerRef}
        type="button"
      >
        <InitialsAvatar name={ownerName} className="h-10 w-10 text-[13px]" />
      </button>

      {open ? (
        <div
          aria-label="Account"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-[12px] border border-line bg-white p-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.10)]"
          id={menuId}
          role="menu"
        >
          <div className="border-b border-line px-2.5 pb-2 pt-1.5">
            <p className="truncate text-[13px] font-bold text-ink">{ownerName}</p>
            <p className="truncate text-[11.5px] text-ink-muted">{shopName}</p>
          </div>
          <div className="grid gap-0.5 pt-1.5">
            <Link className={ITEM_CLASSES} href="/dashboard/settings" role="menuitem">
              Settings
            </Link>
            <Link className={ITEM_CLASSES} href="/dashboard/settings/billing" role="menuitem">
              Plan &amp; billing
            </Link>
            <SignOutForm className={`${ITEM_CLASSES} font-semibold text-danger hover:bg-danger-tint hover:text-danger`} role="menuitem" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
