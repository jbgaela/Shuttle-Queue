// Deployed by Netlify; kept independent of Next.js and the backend workspace.
type EdgeContext = { ip: string; requestId: string; geo?: { city?: string; subdivision?: { name?: string }; country?: { name?: string } } };
declare const Netlify: { env: { get(name: string): string | undefined } };
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export default async function rankingVisitor(request: Request, context: EdgeContext) {
  const secret = Netlify.env.get("PUBLIC_RANKING_EDGE_SECRET");
  const base = Netlify.env.get("BACKEND_API_BASE_URL");
  if (!secret || secret.length < 32 || !base) return failure(503, "TRACKING_UNAVAILABLE", "Public rankings are temporarily unavailable.");
  const url = new URL(request.url);
  if (!["GET", "POST", "PATCH"].includes(request.method)) return failure(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  if (request.headers.get("content-encoding")) return failure(415, "UNSUPPORTED_MEDIA_TYPE", "Compressed tracking requests are not supported.");
  // Read with a byte bound even when Content-Length is absent or forged.
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 4096) { await reader.cancel(); return failure(413, "PAYLOAD_TOO_LARGE", "Tracking requests must be at most 4 KB."); }
      chunks.push(result.value);
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  const metadataBytes = encoder.encode(JSON.stringify({ timestamp: Date.now(), requestId: context.requestId, ip: context.ip, userAgent: (request.headers.get("user-agent") ?? "").slice(0, 1024), city: context.geo?.city?.slice(0, 200) ?? null, region: context.geo?.subdivision?.name?.slice(0, 200) ?? null, country: context.geo?.country?.name?.slice(0, 200) ?? null }));
  const metadata = btoa(Array.from(metadataBytes, (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const destination = new URL(`${base.replace(/\/$/, "")}${url.pathname.slice("/api/v2".length)}${url.search}`);
  if (destination.protocol !== "https:") return failure(503, "TRACKING_UNAVAILABLE", "Public rankings are temporarily unavailable.");
  const digest = hex(await crypto.subtle.digest("SHA-256", body));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = hex(await crypto.subtle.sign("HMAC", key, encoder.encode([request.method, destination.pathname + destination.search, digest, metadata].join("\n"))));
  // An allowlist prevents client-supplied metadata, cookies, and credentials reaching Render.
  const headers = new Headers({ "x-ranking-edge-metadata": metadata, "x-ranking-edge-signature": signature });
  for (const name of ["content-type", "x-ranking-visit-key"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  try {
    const upstream = await fetch(destination, { method: request.method, headers, ...(size ? { body } : {}), redirect: "error", signal: AbortSignal.timeout(15000) });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("set-cookie");
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return failure(503, "TRACKING_UNAVAILABLE", "Unable to connect. Please try again."); }
}

export const config = { path: "/api/v2/public/rankings/*" };
