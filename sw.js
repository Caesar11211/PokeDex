// sw.js — lets the app open without a connection.
// The app's own page always comes from the internet first, so an upload to GitHub shows up as soon
// as GitHub Pages has published it. The saved copy is only used when you're offline.
// Card lookups and prices always go to the internet.
// When you change any app file, bump VERSION so phones fetch the new copy.
const VERSION = "living-dex-v24";
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  // cache: "reload" skips any copy the browser or GitHub's servers are holding, so a new version
  // never saves the old page
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const fresh = (req) => fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" }));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // APIs, fonts, card images: straight to the network
  const page = e.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html") || url.pathname.endsWith(".webmanifest");
  // The app itself and the daily data lists: internet first, saved copy when offline
  if (page || url.pathname.includes("/data/")) {
    e.respondWith(fresh(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(page ? new Request(url.origin + url.pathname) : e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
    return;
  }
  // Icons: the saved copy straight away
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
