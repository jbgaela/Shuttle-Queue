# Shuttle Queue web app

Next.js App Router dashboard for Queue Masters. Set the server-only `BACKEND_API_BASE_URL` to the backend `/api/v2` URL; the browser calls the API through the same-origin Next.js proxy. In production, include the deployed frontend origin in the backend `FRONTEND_ORIGINS` value. Then run:

```powershell
npm install
npm run dev
```

## Netlify ranking tracking

Deploy with the frontend directory as the Netlify project root. `netlify/edge-functions/ranking-visitor.ts` handles `/api/v2/public/rankings/*`, signs Netlify's observed visitor IP and approximate location, and forwards to the HTTPS `BACKEND_API_BASE_URL`. Configure `PUBLIC_RANKING_EDGE_SECRET` as a server-only Edge Functions environment variable, matching Render. Never use a `NEXT_PUBLIC_` variable for this secret. Other API paths continue through the existing Next.js rewrite. Render starts with public-ranking access disabled until this matching secret is configured.

Public links use `/rankings/shared/[token]`. The bare `/rankings/share` URL has no corresponding local token contract. Deploy the edge proxy and location gate together with the backend tracking endpoints and database setup, verify a preview, then enable `PUBLIC_RANKING_LOCATION_REQUIRED=true` on Render. The backend's initial `false` rollout setting does not enforce the location requirement on API reads.

Every page opening records a visit before requesting location. Rankings and history stay hidden until browser coordinates are saved; denial, timeout, unsupported location, and persistence failures keep the gate closed. Reloads and restored back/forward pages create new visits, while polling reuses the current visit. Private `/rankings/tracking` pages show 90-day history to the owner and Super Admins, with fixed Manila timestamps. Tracking and public ranking data are never persisted offline.

Run `npx playwright test tests/ui/ranking-tracking.spec.ts --workers=1` for location gating, tracking pagination, privacy, accessibility and mobile checks. Confirm real Netlify metadata and Render signature validation in a deployment preview; local tests do not establish production IP accuracy or apply MongoDB TTL configuration.
