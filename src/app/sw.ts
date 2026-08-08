import { Serwist, NetworkFirst, NetworkOnly } from "serwist";
import type { PrecacheEntry, RuntimeCaching } from "serwist";

declare const self: { __SW_MANIFEST: (PrecacheEntry | string)[] };

const runtimeCaching: RuntimeCaching[] = [
  { matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith("/_next/static/"), handler: new NetworkFirst({ cacheName: "shuttle-static", networkTimeoutSeconds: 3 }) },
  { matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith("/api/"), handler: new NetworkOnly() },
  { matcher: ({ request, sameOrigin, url: { pathname } }) => sameOrigin && request.mode === "navigate" && !pathname.startsWith("/api/"), handler: new NetworkFirst({ cacheName: "shuttle-navigation", networkTimeoutSeconds: 3 }) },
];

const serwist = new Serwist({ precacheEntries: self.__SW_MANIFEST, skipWaiting: true, clientsClaim: true, runtimeCaching, fallbacks: { entries: [{ url: "/", matcher: ({ request }) => request.mode === "navigate" }] } });
serwist.addEventListeners();
