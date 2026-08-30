# Shuttle Queue web app

Next.js App Router dashboard for Queue Masters. Set the server-only `BACKEND_API_BASE_URL` to the backend `/api/v2` URL; the browser calls the API through the same-origin Next.js proxy. In production, include the deployed frontend origin in the backend `FRONTEND_ORIGINS` value. Then run:

```powershell
npm install
npm run dev
```
