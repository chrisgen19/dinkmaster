<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Testing

Four things that are not guessable from the code, each of which has already
cost someone real time.

- **The file extension decides the runner.** `*.test.js` is Vitest (`src/**`,
  plus `e2e/**` for the harness's own units); `*.spec.js` is Playwright. Both
  configs pin this, because Playwright's default `testMatch` would otherwise
  claim `*.test.js` too. Choosing wrong fails quietly rather than loudly: a
  `.test.js` in `e2e/` runs with no browser, a `.spec.js` under `src/` runs
  nowhere.
- **e2e never touches the development database.** Each Playwright config
  derives its own throwaway database (`*_e2e`, `*_e2e_offline`), on its own
  port and build directory, and empties it before every run. So a spec cannot
  rely on data you created by hand, and `E2E_DATABASE_URL` pointing at the
  development database is refused — setup would truncate it.
- **A long-running `next dev` serves stale code** after edits to server-side
  modules or a `prisma generate`. Twice this has looked exactly like a product
  bug — a correct feature failing, a column the client "couldn't see". Restart
  the dev server before debugging anything that seems impossible.
- **Commands**: `pnpm test` (units), `pnpm test:e2e` (browser specs, starts its
  own server), `pnpm test:e2e:offline` (service-worker specs; production
  build, slower). `pnpm lint` before finishing.
