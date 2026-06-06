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

      // Register abort handling BEFORE any await, so a disconnect during setup
      // (the getState read or the subscribe) still triggers cleanup instead of
      // leaving a heartbeat/subscription dangling.
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      if (request.signal.aborted) {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
        return;
      }

      // Tell EventSource to reconnect after 3s if the stream drops.
      enqueue('retry: 3000\n\n');

      // Subscribe BEFORE taking the initial snapshot: a change committing
      // between the snapshot read and the subscribe would NOTIFY while nobody
      // is listening, leaving this client on a stale frame with no push
      // coming. Subscribing first closes that blind window — at worst the
      // client gets a pushed frame and the snapshot out of order, which the
      // client's monotonic `fetchedAt` guard resolves.
      unsubscribe = await realtimeHub.subscribe(id, sendState);
      // If the client disconnected while we were subscribing, `cleanup` already
      // ran against the no-op default unsubscribe; tear down the now-registered
      // subscription so the hub stops invoking this dead connection.
      if (closed) {
        unsubscribe();
        return;
      }

      // Initial sync so a (re)connecting client is immediately consistent.
      try {
        sendState(await getState(id));
      } catch {
        // Transient read failure — the first live change will resync.
      }

      // The client may have disconnected during the snapshot read; `cleanup`
      // (with the real unsubscribe now assigned) already ran, so just don't
      // schedule a heartbeat for a dead stream.
      if (closed) return;

      heartbeat = setInterval(() => enqueue(': ping\n\n'), HEARTBEAT_MS);
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
