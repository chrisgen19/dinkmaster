import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture every pg Client the hub creates so tests can drive connect/LISTEN
// and emit notifications. Hoisted because vi.mock factories run before
// top-level test code.
const h = vi.hoisted(() => ({ clients: [] }));

vi.mock('pg', () => {
  class Client {
    constructor(opts) {
      this.opts = opts;
      this.handlers = {};
      this.connect = vi.fn(async () => {});
      this.query = vi.fn(async () => {});
      this.end = vi.fn(async () => {});
      h.clients.push(this);
    }
    on(event, fn) {
      (this.handlers[event] ??= []).push(fn);
      return this;
    }
    removeAllListeners() {
      this.handlers = {};
    }
    emit(event, ...args) {
      for (const fn of this.handlers[event] ?? []) fn(...args);
    }
  }
  return { Client };
});

vi.mock('@/lib/data', () => ({ getState: vi.fn() }));

import { getState } from '@/lib/data';
import { createHub } from './realtime-listener';

/** Flush pending microtasks + zero-delay macrotasks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const notify = (client, arenaId) =>
  client.emit('notification', { channel: 'arena_events', payload: arenaId });

describe('realtime hub', () => {
  beforeEach(() => {
    h.clients.length = 0;
    getState.mockReset();
    getState.mockResolvedValue({ fetchedAt: 1, players: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects once, LISTENs, and resyncs the subscribed arena on connect', async () => {
    const hub = createHub();
    const cb = vi.fn();
    await hub.subscribe('arena-1', cb);
    await settle();

    expect(h.clients).toHaveLength(1);
    expect(h.clients[0].connect).toHaveBeenCalledTimes(1);
    expect(h.clients[0].query).toHaveBeenCalledWith('LISTEN arena_events');
    // Connect-time resync delivers an initial frame to the subscriber.
    expect(cb).toHaveBeenCalledWith({ fetchedAt: 1, players: [] });
  });

  it('shares one connection across concurrent subscribers', async () => {
    const hub = createHub();
    await Promise.all([
      hub.subscribe('arena-1', vi.fn()),
      hub.subscribe('arena-2', vi.fn()),
      hub.subscribe('arena-1', vi.fn()),
    ]);
    expect(h.clients).toHaveLength(1);
  });

  it('reads once per notification and fans out to all of the arena subscribers', async () => {
    const hub = createHub();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    await hub.subscribe('arena-1', cb1);
    await hub.subscribe('arena-1', cb2);
    await settle();
    getState.mockClear();
    cb1.mockClear();
    cb2.mockClear();

    notify(h.clients[0], 'arena-1');
    await settle();

    expect(getState).toHaveBeenCalledTimes(1); // one read, not one per subscriber
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('ignores notifications for arenas without subscribers', async () => {
    const hub = createHub();
    await hub.subscribe('arena-1', vi.fn());
    await settle();
    getState.mockClear();

    notify(h.clients[0], 'arena-2');
    await settle();

    expect(getState).not.toHaveBeenCalled();
  });

  it('coalesces a burst of notifications into one trailing read', async () => {
    const hub = createHub();
    const cb = vi.fn();
    await hub.subscribe('arena-1', cb);
    await settle();
    getState.mockClear();
    cb.mockClear();

    // Make reads resolvable by hand so the burst lands mid-read.
    const resolvers = [];
    getState.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    notify(h.clients[0], 'arena-1'); // starts read #1
    await settle();
    notify(h.clients[0], 'arena-1'); // marks dirty while read #1 is in flight
    notify(h.clients[0], 'arena-1');
    notify(h.clients[0], 'arena-1');
    await settle();
    expect(resolvers).toHaveLength(1); // burst did not spawn parallel reads

    resolvers[0]({ fetchedAt: 10 });
    await settle();
    expect(resolvers).toHaveLength(2); // ...just one trailing re-read

    resolvers[1]({ fetchedAt: 11 });
    await settle();
    expect(getState).toHaveBeenCalledTimes(2);
    // Frames delivered in read order — never an older frame after a newer one.
    expect(cb.mock.calls.map(([s]) => s.fetchedAt)).toEqual([10, 11]);
  });

  it('retries a failed read instead of dropping the notification', async () => {
    vi.useFakeTimers();
    const hub = createHub();
    const cb = vi.fn();
    await hub.subscribe('arena-1', cb);
    await vi.advanceTimersByTimeAsync(0);
    getState.mockClear();
    cb.mockClear();

    getState
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce({ fetchedAt: 42 });

    notify(h.clients[0], 'arena-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(cb).not.toHaveBeenCalled(); // failed read delivered nothing...

    await vi.advanceTimersByTimeAsync(1000); // ...but the delayed retry does
    expect(getState).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith({ fetchedAt: 42 });
  });

  it('stops delivering after unsubscribe', async () => {
    const hub = createHub();
    const cb = vi.fn();
    const unsubscribe = await hub.subscribe('arena-1', cb);
    await settle();
    cb.mockClear();

    unsubscribe();
    notify(h.clients[0], 'arena-1');
    await settle();

    expect(cb).not.toHaveBeenCalled();
  });

  it('reconnects after a connection failure and resyncs subscribers', async () => {
    vi.useFakeTimers();
    const hub = createHub();
    const cb = vi.fn();
    await hub.subscribe('arena-1', cb);
    await vi.advanceTimersByTimeAsync(0);
    cb.mockClear();

    getState.mockResolvedValue({ fetchedAt: 99 });
    h.clients[0].emit('error', new Error('connection lost'));
    await vi.advanceTimersByTimeAsync(1000); // reconnect delay

    expect(h.clients).toHaveLength(2); // a fresh client replaced the dead one
    expect(h.clients[1].query).toHaveBeenCalledWith('LISTEN arena_events');
    // Post-reconnect resync pushed current state (outage NOTIFYs aren't replayed).
    expect(cb).toHaveBeenCalledWith({ fetchedAt: 99 });
  });

  it('one isolated failing stream does not block delivery to the others', async () => {
    const hub = createHub();
    const bad = vi.fn(() => {
      throw new Error('dead controller');
    });
    const good = vi.fn();
    await hub.subscribe('arena-1', bad);
    await hub.subscribe('arena-1', good);
    await settle();
    good.mockClear();

    notify(h.clients[0], 'arena-1');
    await settle();

    expect(good).toHaveBeenCalledTimes(1);
  });
});
