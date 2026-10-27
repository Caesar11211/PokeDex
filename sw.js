// sw.js — lets the app open without a connection, and load fast.
// It keeps a copy of the app's own files. Card lookups and prices always go to the internet.
// When you change any app file, bump VERSION so phones fetch the new copy.
const VERSION = "living-dex-v21";
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // APIs, fonts, card images: straight to the network
  // The daily top-cards list: always try the network first, fall back to the saved copy offline.
  if (url.pathname.includes("/data/")) {
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  // The app page itself: get the latest version whenever online (so updates show straight away),
  // falling back to the saved copy when offline or the network is slow.
  if (e.request.mode === "navigate" || /\/(index\.html)?$/.test(url.pathname)) {
    e.respondWith(caches.open(VERSION).then(async cache => {
      try {
        const res = await Promise.race([fetch(e.request, { cache: "no-store" }), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 5000))]);
        if (res.ok) cache.put("index.html", res.clone());
        return res;
      } catch {
        return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match("index.html")) || Response.error();
      }
    }));
    return;
  }
  // Use the saved copy straight away, and refresh it in the background for next time.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => cached);
    return cached || fresh;
  }));
});
