import { realtimeHub } from '@/lib/realtime-listener';
import { getState } from '@/lib/data';
import { getArena } from '@/lib/arenas';

// Server-Sent Events stream of live arena state. Needs the Node.js runtime
// (the realtime hub holds a long-lived `pg` LISTEN connection) and must never
// be cached or statically rendered.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

/**
 * GET /api/arena/[id]/stream
 *
 * Opens an SSE stream that emits a `state` event (the full `getState(id)`
 * payload) immediately on connect — so a fresh or reconnected client re-syncs
 * and catches any changes it missed — and again on every subsequent change to
 * the arena. The arena board is publicly viewable (the page renders for
 * spectators), so this mirrors that and only requires the arena to exist.
 */
export async function GET(request, { params }) {
  const { id } = await params;

  const arena = await getArena(id);
  if (!arena) return new Response('Not found', { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat = null;
  let unsubscribe = () => {};

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe();
  };

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed (client gone mid-write).
          cleanup();
        }
      };
      const sendState = (state) => enqueue(`event: state\ndata: ${JSON.stringify(state)}\n\n`);

      // Tell EventSource to reconnect after 3s if the stream drops.
      enqueue('retry: 3000\n\n');

      // Initial sync so a (re)connecting client is immediately consistent.
      try {
        sendState(await getState(id));
      } catch {
        // Transient read failure — the first live change will resync.
      }

      unsubscribe = await realtimeHub.subscribe(id, sendState);

      heartbeat = setInterval(() => enqueue(': ping\n\n'), HEARTBEAT_MS);

      // Client navigated away / closed the tab.
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx/Traefik) so events flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
