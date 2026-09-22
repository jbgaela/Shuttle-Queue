// Deployed by Netlify; kept independent of Next.js and the backend workspace.
type EdgeContext = {
  ip: string;
  requestId: string;
  geo?: {
    city?: string;
    subdivision?: { name?: string };
    country?: { name?: string };
  };
};

type EdgeConfiguration = {
  backendUrl: URL;
  secret: string;
};

type ConfigurationFailureReason =
  | "missing_secret"
  | "short_secret"
  | "missing_backend_url"
  | "invalid_backend_url";

declare const Netlify: {
  env: { get(name: string): string | undefined };
};

const encoder = new TextEncoder();
const allowedMethods = new Set(["GET", "POST", "PATCH"]);

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");

function failure(
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return Response.json(
    { error: { code, message }, requestId },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function readConfiguration():
  | { configuration: EdgeConfiguration; reason?: never }
  | { configuration?: never; reason: ConfigurationFailureReason } {
  const secret = Netlify.env.get("PUBLIC_RANKING_EDGE_SECRET");
  if (!secret) return { reason: "missing_secret" };
  if (secret.length < 32) return { reason: "short_secret" };

  const configuredBackendUrl = Netlify.env.get("BACKEND_API_BASE_URL");
  if (!configuredBackendUrl) return { reason: "missing_backend_url" };

  try {
    const backendUrl = new URL(configuredBackendUrl);
    const normalizedPath = backendUrl.pathname.replace(/\/$/, "");
    if (
      backendUrl.protocol !== "https:" ||
      backendUrl.username ||
      backendUrl.password ||
      backendUrl.search ||
      backendUrl.hash ||
      normalizedPath !== "/api/v2"
    ) {
      return { reason: "invalid_backend_url" };
    }
    backendUrl.pathname = normalizedPath;
    return { configuration: { backendUrl, secret } };
  } catch {
    return { reason: "invalid_backend_url" };
  }
}

async function readBoundedBody(request: Request) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();

  if (reader) {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

export default async function rankingVisitor(
  request: Request,
  context: EdgeContext,
) {
  const result = readConfiguration();
  if (result.reason) {
    console.error(
      `[ranking-visitor] configuration_error reason=${result.reason} requestId=${context.requestId}`,
    );
    return failure(
      503,
      "EDGE_CONFIGURATION_ERROR",
      "Shared rankings are temporarily unavailable. Please try again later.",
      context.requestId,
    );
  }

  if (!allowedMethods.has(request.method)) {
    return failure(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed.",
      context.requestId,
    );
  }
  if (request.headers.get("content-encoding")) {
    return failure(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Compressed tracking requests are not supported.",
      context.requestId,
    );
  }

  const body = await readBoundedBody(request);
  if (!body) {
    return failure(
      413,
      "PAYLOAD_TOO_LARGE",
      "Tracking requests must be at most 4 KB.",
      context.requestId,
    );
  }

  const url = new URL(request.url);
  const upstreamPath = url.pathname.slice("/api/v2".length);
  const destination = new URL(
    `${result.configuration.backendUrl.origin}/api/v2${upstreamPath}${url.search}`,
  );
  const metadataBytes = encoder.encode(
    JSON.stringify({
      timestamp: Date.now(),
      requestId: context.requestId,
      ip: context.ip,
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 1024),
      city: context.geo?.city?.slice(0, 200) ?? null,
      region: context.geo?.subdivision?.name?.slice(0, 200) ?? null,
      country: context.geo?.country?.name?.slice(0, 200) ?? null,
    }),
  );
  const metadata = btoa(
    Array.from(metadataBytes, (byte) => String.fromCharCode(byte)).join(""),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const digest = hex(await crypto.subtle.digest("SHA-256", body));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(result.configuration.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        [
          request.method,
          destination.pathname + destination.search,
          digest,
          metadata,
        ].join("\n"),
      ),
    ),
  );

  // An allowlist prevents client-supplied metadata, cookies, and credentials reaching Render.
  const headers = new Headers({
    "x-ranking-edge-metadata": metadata,
    "x-ranking-edge-signature": signature,
  });
  for (const name of ["content-type", "x-ranking-visit-key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstream = await fetch(destination, {
      method: request.method,
      headers,
      ...(body.byteLength ? { body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("set-cookie");
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    console.error(
      `[ranking-visitor] upstream_unavailable requestId=${context.requestId}`,
    );
    return failure(
      503,
      "UPSTREAM_UNAVAILABLE",
      "Unable to connect to shared rankings. Please try again.",
      context.requestId,
    );
  }
}

export const config = { path: "/api/v2/public/rankings/*" };
