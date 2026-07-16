"use client";

import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return offline ? (
    <div
      role="status"
      className="sticky top-0 z-[100] border-b border-warn-line bg-warn-tint px-3 py-2 text-center text-[13px] font-bold text-warn"
    >
      You&rsquo;re offline. Valid form details stay on screen — reconnect before submitting.
    </div>
  ) : null;
}
