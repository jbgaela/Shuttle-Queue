import { Serwist, NetworkFirst, NetworkOnly } from "serwist";
import type { PrecacheEntry, RuntimeCaching } from "serwist";

declare const self: { __SW_MANIFEST: (PrecacheEntry | string)[] };

const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith("/rankings/"),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ sameOrigin, url: { pathname } }) =>
      sameOrigin && pathname.startsWith("/_next/static/"),
    handler: new NetworkFirst({ cacheName: "shuttle-static", networkTimeoutSeconds: 3 }),
  },
  {
    matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ request, sameOrigin, url: { pathname } }) =>
      sameOrigin && request.mode === "navigate" && !pathname.startsWith("/api/"),
    handler: new NetworkFirst({ cacheName: "shuttle-navigation", networkTimeoutSeconds: 3 }),
  },
];

// The first document loads before the worker controls it. Precache the shell
// explicitly so an immediate offline reload works, and refresh it with each build.
let shellRevision = 2166136261;
for (const character of JSON.stringify(self.__SW_MANIFEST))
  shellRevision = Math.imul(shellRevision ^ character.charCodeAt(0), 16777619);
const precacheEntries = self.__SW_MANIFEST.filter((entry) => {
  const url = typeof entry === "string" ? entry : entry.url;
  return url !== "/" && !url.startsWith("/rankings/");
});
const serwist = new Serwist({
  precacheEntries: [...precacheEntries, { url: "/", revision: (shellRevision >>> 0).toString(16) }],
  precacheOptions: {
    navigateFallback: "/",
    navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/rankings(?:\/|$)/],
  },
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching,
});
serwist.addEventListeners();
