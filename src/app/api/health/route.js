// Route Handlers are uncached by default in this Next version, but this is
// pinned explicitly so enabling Cache Components later cannot silently
// prerender the probe into a static response that no longer proves the server
// is up.
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Container liveness probe for the Coolify/Docker healthcheck. Deliberately
 * touches neither the database nor auth: every app on this host shares one
 * Postgres, so a deep check would mark all of them unhealthy during a single
 * database blip and restart the lot at once. This answers only "is the server
 * serving HTTP?".
 */
export function GET() {
  return Response.json({ status: 'ok' }, { status: 200 });
}
