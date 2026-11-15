// Kairox Pay service worker: makes the site installable and shows a friendly page when there is no internet.
// It NEVER stores payroll data: requests to Supabase (another site) are not touched, and pages and scripts are always
// fetched fresh from the network first, so a new version on GitHub Pages shows up straight away.
const CACHE = "kairox-shell-v1";
const SHELL = ["offline.html", "assets/icons/icon-192.png", "assets/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // Pages: always the network; if offline, the offline page. Nothing is saved.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("offline.html")));
  }
});
