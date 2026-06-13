"use client";

import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return offline ? <div className="sticky top-0 z-50 bg-amber-300 px-3 py-2 text-center font-bold text-amber-950" role="status">You are offline. Valid form details stay on screen; reconnect before submitting.</div> : null;
}
