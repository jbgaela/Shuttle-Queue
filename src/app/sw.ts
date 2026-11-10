import { Serwist, NetworkFirst } from "serwist";
import type { PrecacheEntry, RuntimeCaching } from "serwist";

declare const __OFFLINE_BUILD_ID__: string;
type OfflineWindowClient = {
  id: string;
  postMessage(message: unknown, transfer: Transferable[]): void;
};
type OfflineMessageEvent = {
  data?: WorkerCommand;
  ports: MessagePort[];
  source: { id: string } | null;
  waitUntil(promise: Promise<unknown>): void;
};
declare const self: {
  __SW_MANIFEST: (PrecacheEntry | string)[];
  caches: CacheStorage;
  location: Location;
  clients: {
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<OfflineWindowClient[]>;
  };
  addEventListener(type: "message", listener: (event: OfflineMessageEvent) => void): void;
  skipWaiting(): Promise<void>;
};
const OFFLINE_WORKER_PROTOCOL_VERSION = 1;

const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ sameOrigin, url: { pathname } }) =>
      sameOrigin && pathname.startsWith("/_next/static/"),
    handler: new NetworkFirst({
      cacheName: `shuttle-static-${__OFFLINE_BUILD_ID__}`,
      networkTimeoutSeconds: 3,
    }),
  },
  {
    matcher: ({ request, sameOrigin, url: { pathname } }) =>
      sameOrigin &&
      request.mode === "navigate" &&
      !pathname.startsWith("/api/") &&
      !pathname.startsWith("/rankings/"),
    handler: new NetworkFirst({
      cacheName: `shuttle-navigation-${__OFFLINE_BUILD_ID__}`,
      networkTimeoutSeconds: 3,
    }),
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
    cacheName: `shuttle-precache-${__OFFLINE_BUILD_ID__}`,
    navigateFallback: "/",
    navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/rankings(?:\/|$)/],
  },
  skipWaiting: false,
  clientsClaim: true,
  runtimeCaching,
});
serwist.addEventListeners();

type WorkerCommand = {
  type: string;
  protocolVersion?: number;
  requestId?: string;
  buildId?: string;
};

function reply(event: OfflineMessageEvent, value: Record<string, unknown>) {
  event.ports[0]?.postMessage({
    protocolVersion: OFFLINE_WORKER_PROTOCOL_VERSION,
    requestId: String(event.data?.requestId ?? ""),
    buildId: __OFFLINE_BUILD_ID__,
    verified: 0,
    total: serwist.getPrecachedUrls().length,
    ...value,
  });
}

async function isValidResponse(url: string, response: Response | undefined) {
  if (!response?.ok || response.type === "opaque") return false;
  const pathname = new URL(url).pathname.toLowerCase();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (pathname === "/offline-build.json") {
    if (!contentType.includes("json")) return false;
    const metadata = await response
      .clone()
      .json()
      .catch(() => null);
    return (
      metadata?.buildId === __OFFLINE_BUILD_ID__ &&
      metadata.protocolVersion === OFFLINE_WORKER_PROTOCOL_VERSION
    );
  }
  if (pathname.endsWith(".js") || pathname.endsWith(".mjs"))
    return contentType.includes("javascript");
  if (pathname.endsWith(".css")) return contentType.includes("text/css");
  if (pathname === "/")
    return (
      contentType.includes("text/html") &&
      response.headers.get("x-shuttle-build-id") === __OFFLINE_BUILD_ID__
    );
  if (pathname.endsWith(".html")) return contentType.includes("text/html");
  if (pathname.endsWith(".json") || pathname.endsWith(".webmanifest"))
    return contentType.includes("json") || contentType.includes("manifest");
  if (pathname.endsWith(".svg")) return contentType.includes("image/svg+xml");
  if (/\.(png|jpe?g|gif|webp|avif|ico)$/.test(pathname)) return contentType.startsWith("image/");
  if (/\.(woff2?|ttf|otf)$/.test(pathname)) return contentType.startsWith("font/");
  return true;
}

async function verifyCache(event: OfflineMessageEvent) {
  const request = event.data as WorkerCommand;
  if (request.buildId !== __OFFLINE_BUILD_ID__) {
    reply(event, { ok: false, error: "This app is paired with a different offline worker." });
    return;
  }
  const entries = [...serwist.getUrlsToPrecacheKeys()];
  const missing: string[] = [];
  let verified = 0;
  for (const [url] of entries) {
    const response = await serwist.matchPrecache(url).catch(() => undefined);
    if (!(await isValidResponse(url, response))) missing.push(url);
    else verified += 1;
    reply(event, {
      ok: true,
      verified,
      total: entries.length,
      progress: { verified, total: entries.length },
    });
  }
  reply(event, { ok: true, verified, total: entries.length, missing });
  if (!missing.length) await cleanupUnusedCaches().catch(() => undefined);
}

async function repairCache(event: OfflineMessageEvent) {
  const request = event.data as WorkerCommand;
  if (request.buildId !== __OFFLINE_BUILD_ID__) {
    reply(event, { ok: false, error: "This app is paired with a different offline worker." });
    return;
  }
  const entries = [...serwist.getUrlsToPrecacheKeys()];
  const cache = await caches.open(serwist.precacheStrategy.cacheName);
  let verified = 0;
  for (const [url, cacheKey] of entries) {
    const existing = await serwist.matchPrecache(url).catch(() => undefined);
    if (!(await isValidResponse(url, existing))) {
      const parsed = new URL(url);
      if (
        parsed.origin !== self.location.origin ||
        parsed.pathname.startsWith("/api/") ||
        parsed.pathname.startsWith("/rankings/")
      )
        continue;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9_000);
      try {
        const response = await fetch(url, {
          cache: "reload",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (await isValidResponse(url, response)) await cache.put(cacheKey, response.clone());
      } catch {
        /* A failed asset remains missing and keeps readiness blocked. */
      } finally {
        clearTimeout(timeoutId);
      }
    }
    if (await isValidResponse(url, await serwist.matchPrecache(url).catch(() => undefined)))
      verified += 1;
    reply(event, {
      ok: true,
      verified,
      total: entries.length,
      progress: { verified, total: entries.length },
    });
  }
  const missing = [];
  for (const [url] of entries)
    if (!(await isValidResponse(url, await serwist.matchPrecache(url).catch(() => undefined))))
      missing.push(url);
  reply(event, {
    ok: true,
    verified,
    total: entries.length,
    missing,
    ...(missing.length ? { error: "Some app files could not be downloaded." } : {}),
  });
}

async function readClientBuild(client: OfflineWindowClient) {
  return new Promise<string | null>((resolve) => {
    const channel = new MessageChannel();
    const timeoutId = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, 9_000);
    channel.port1.onmessage = (
      event: MessageEvent<{ protocolVersion?: number; buildId?: string }>,
    ) => {
      clearTimeout(timeoutId);
      channel.port1.close();
      resolve(
        event.data?.protocolVersion === OFFLINE_WORKER_PROTOCOL_VERSION &&
          typeof event.data.buildId === "string"
          ? event.data.buildId
          : null,
      );
    };
    client.postMessage(
      { type: "OFFLINE_BUILD_QUERY", protocolVersion: OFFLINE_WORKER_PROTOCOL_VERSION },
      [channel.port2],
    );
  });
}

async function cleanupUnusedCaches() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const builds = await Promise.all(clients.map(readClientBuild));
  if (builds.some((buildId) => buildId !== __OFFLINE_BUILD_ID__)) return;
  const obsolete = (await caches.keys()).filter(
    (name) =>
      /^shuttle-(precache|static|navigation)-/.test(name) && !name.includes(__OFFLINE_BUILD_ID__),
  );
  await Promise.all(obsolete.map((name) => caches.delete(name)));
}

async function activateIfSafe(event: OfflineMessageEvent) {
  const request = event.data as WorkerCommand;
  if (request.buildId !== __OFFLINE_BUILD_ID__) {
    reply(event, { ok: false, error: "This app is paired with a different offline worker." });
    return;
  }
  const currentClientId = event.source?.id;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const otherClients = clients.filter((client) => client.id !== currentClientId);
  const builds = await Promise.all(otherClients.map((client) => readClientBuild(client)));
  const olderClients = builds.filter((buildId) => buildId !== __OFFLINE_BUILD_ID__).length;
  if (olderClients) {
    reply(event, { ok: true, activated: false, olderClients, verified: 0, total: 0 });
    return;
  }
  reply(event, { ok: true, activated: true, olderClients: 0, verified: 0, total: 0 });
  await self.skipWaiting();
}

self.addEventListener("message", (event: OfflineMessageEvent) => {
  const request = event.data as WorkerCommand | undefined;
  if (!request?.type?.startsWith("OFFLINE_")) return;
  if (request.protocolVersion !== OFFLINE_WORKER_PROTOCOL_VERSION) {
    reply(event, {
      ok: false,
      error: "This offline worker protocol is not supported. Reload and retry.",
    });
    return;
  }
  if (request.type === "OFFLINE_GET_BUILD") {
    reply(event, { ok: true, verified: 0, total: serwist.getPrecachedUrls().length });
    return;
  }
  event.waitUntil(
    (request.type === "OFFLINE_VERIFY_CACHE"
      ? verifyCache(event)
      : request.type === "OFFLINE_REPAIR_CACHE"
        ? repairCache(event)
        : request.type === "OFFLINE_ACTIVATE_IF_SAFE"
          ? activateIfSafe(event)
          : Promise.resolve(reply(event, { ok: false, error: "Unsupported worker request." }))
    ).catch(() =>
      reply(event, { ok: false, error: "Offline files could not be checked. Retry preparation." }),
    ),
  );
});
