import type { Page, Request as PlaywrightRequest, Route } from "@playwright/test";

type Handler = (route: Route, request: PlaywrightRequest) => unknown | Promise<unknown>;
type FixtureRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};
type FixtureReply = { status: number; headers: Record<string, string>; body: string };
type Fixture = { pattern: RegExp; handler: Handler };
const fixtures = new WeakMap<Page, Fixture[]>();

export async function routeApi(page: Page, pattern: string, handler: Handler) {
  if (page.context().browser()?.browserType().name() !== "webkit") {
    await page.route(pattern, handler);
    return;
  }

  let handlers = fixtures.get(page);
  if (!handlers) {
    handlers = [];
    fixtures.set(page, handlers);
    await page.exposeBinding("__shuttleUiFixtureFetch", async (_source, input: FixtureRequest) => {
      const fixture = fixtures.get(page)?.findLast((entry) => entry.pattern.test(input.url));
      if (!fixture) throw new Error("No UI API fixture matches " + input.url);
      const request = {
        url: () => input.url,
        method: () => input.method,
        headers: () => input.headers,
        postData: () => input.body,
        postDataJSON: () => (input.body ? JSON.parse(input.body) : null),
      } as unknown as PlaywrightRequest;
      let reply: FixtureReply | undefined;
      const route = {
        request: () => request,
        fulfill: async (options: Parameters<Route["fulfill"]>[0]) => {
          const headers = { ...options.headers };
          let body =
            typeof options.body === "string" ? options.body : (options.body?.toString() ?? "");
          if (options.json !== undefined) {
            body = JSON.stringify(options.json);
            headers["content-type"] ??= "application/json";
          }
          if (options.contentType) headers["content-type"] = options.contentType;
          reply = { status: options.status ?? 200, headers, body };
        },
      } as unknown as Route;
      await fixture.handler(route, request);
      if (!reply) throw new Error("The UI API fixture did not fulfill " + input.url);
      return reply;
    });
    // WebKit cannot reliably route API requests from worker-controlled pages.
    // Keep the real worker and app assets; adapt only these existing mocked APIs.
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      const invoke = (
        window as unknown as {
          __shuttleUiFixtureFetch: (request: FixtureRequest) => Promise<FixtureReply>;
        }
      ).__shuttleUiFixtureFetch;
      window.fetch = async (input, init) => {
        const request = new Request(input, init);
        if (!new URL(request.url).pathname.startsWith("/api/v2/"))
          return originalFetch(input, init);
        if (request.signal.aborted)
          throw new DOMException("The request was aborted.", "AbortError");
        const reply = await invoke({
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body: ["GET", "HEAD"].includes(request.method) ? null : await request.text(),
        });
        if (request.signal.aborted)
          throw new DOMException("The request was aborted.", "AbortError");
        return new Response([204, 205, 304].includes(reply.status) ? null : reply.body, {
          status: reply.status,
          headers: reply.headers,
        });
      };
    });
  }

  handlers.push({
    pattern: new RegExp(
      "^" +
        pattern
          .split("**")
          .map((part) => part.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"))
          .join(".*") +
        "$",
    ),
    handler,
  });
}
