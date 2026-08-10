# Frontend UI coverage manifest

The frontend is a single Next.js App Router route (`/`). Authenticated Queue Master and Super Admin experiences are application states inside that route; there are no additional product routes in `frontend/src/app`.

## Browser and viewport matrix

- Playwright projects: Chromium, Firefox, WebKit.
- Responsive checks: 320×568, 360×800, 375×812, 390×844, 412×915, 568×320, 844×390, 768×1024, 1024×768, 1024×1366, 1280×720, 1366×768, 1440×900, 1920×1080.
- Accessibility and visual checks: representative 320×568 mobile, 768×1024 tablet, and 1440×900 desktop sizes in every browser project.

## Route/state inventory

| Surface | Deterministic coverage |
| --- | --- |
| Unauthenticated login | Responsive form layout and named controls at 320px |
| Authenticated shell | Header, session switcher, sign-out, sticky chrome, offline bootstrap |
| Live | Active courts, occupied/available/closed states, queued match, score dialog entry point, court management |
| Queue | Automated suggestion panel, manual matchmaking panel, player picker dialog, queue status/actions |
| Players | Roster rows, long player name, check-in/out/rest actions, empty/loading/error branches in component paths |
| History | Completed match card, expandable score/team details, search, pagination controls |
| Rankings | Ranking rows, expandable player history and statistics |
| Fees | Allocation, payment recording, method filters, player summary, ledger |
| Settings | Session overview, scoring, late-arrival configuration, reset/delete confirmation paths, and role-gated Super Admin account/security controls |
| Loading/empty/error/validation/disabled | Existing branch markup is exercised through the deterministic populated snapshot and focused interaction assertions; API failures and zero-record fixtures remain follow-up fixture variants |
| Overlays | Manual picker, court management, confirmation/score dialog paths, Escape dismissal and focus-visible controls |
| Offline/synchronization | Synthetic snapshot download through the same Dexie-backed offline repository used by production |
| Stateful workflows | `workflows.spec.ts` covers court creation, scoring, manual and suggested matchmaking edits, player creation, ranking detail/history, fee collection, sync/offline controls, and sign-out across Chromium, Firefox, and WebKit |
| Generated routes | `/_not-found`, `/manifest.webmanifest`, and `/serwist/sw.js` are framework/generated assets; the product has no custom not-found page |

## Layout assertions

The reusable responsive helper checks root horizontal overflow, interactive controls leaving the viewport, and non-intentional text clipping. Deliberately scrollable tab navigation is scoped to its own element and is not treated as page-level overflow.

Live backend/auth integration, Super Admin account-management actions, and dedicated zero-record/API-failure fixture variants remain release follow-up coverage; the current suite uses a deterministic authenticated API/IndexedDB fixture so layout and interaction regressions are reproducible.
