const CACHE = "snapduka-static-v1";
const STATIC = ["/", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const privatePath = /^\/(api|orders|dashboard|admin|onboarding|login|auth)(\/|$)/.test(url.pathname) || url.pathname.includes("/checkout");
  if (event.request.method !== "GET" || privatePath || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && ["style","script","image","font"].includes(event.request.destination)) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
