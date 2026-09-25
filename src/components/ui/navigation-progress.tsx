"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A thin bar across the top of the screen while the next page loads.
 *
 * On a slow connection a tapped link used to give no sign it had worked, so
 * people tapped again. The bar starts the moment an internal link is followed
 * (or the back button is used), creeps towards the end while the server
 * answers, and completes when the new URL has rendered. It never reaches 100%
 * on its own, so it cannot claim a page loaded that has not.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  // Depend on the string, not the object: a new object with the same query
  // must not restart the effect and cancel the pending hide.
  const search = useSearchParams().toString();
  const [progress, setProgress] = useState<number | null>(null);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const current = useRef("");

  function stopTrickle() {
    if (trickle.current) clearInterval(trickle.current);
    trickle.current = null;
  }

  function start() {
    stopTrickle();
    setProgress(8);
    trickle.current = setInterval(() => {
      setProgress((value) => (value === null ? null : value + (90 - value) * 0.12));
    }, 250);
  }

  // A new URL has rendered: finish the bar, then hide it.
  useEffect(() => {
    const url = `${pathname}?${search}`;
    if (current.current && current.current !== url) {
      stopTrickle();
      setProgress(100);
      const hide = setTimeout(() => setProgress(null), 250);
      current.current = url;
      return () => clearTimeout(hide);
    }
    current.current = url;
    return undefined;
  }, [pathname, search]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    }
    function onPopState() {
      start();
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      stopTrickle();
    };
  }, []);

  if (progress === null) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
      <div
        className="h-full bg-accent transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }}
      />
      <span className="sr-only" role="status">
        Loading page
      </span>
    </div>
  );
}
