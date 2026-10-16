import { describe, expect, it, vi } from 'vitest';
import {
  type EventSourceLike,
  orgEventsUrl,
  parseOrgEvent,
  subscribeOrgEvents,
} from './org-events';

const BATCH = '0199e8a0-0000-7000-8000-0000000000aa';
const progress = {
  id: '17',
  at: '2026-10-15T13:00:00.000Z',
  type: 'import.progress',
  data: { batchId: BATCH, phase: 'parse', processed: 120, total: 500 },
};

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  readonly listeners = new Map<string, (ev: MessageEvent<string>) => void>();
  constructor(
    readonly url: string,
    readonly init: EventSourceInit,
  ) {}
  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.(
      new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data) }),
    );
  }
}

function setup() {
  let source: FakeEventSource | undefined;
  const handlers = { 'import.progress': vi.fn(), 'import.completed': vi.fn() };
  const onStatus = vi.fn();
  const onInvalid = vi.fn();
  const unsubscribe = subscribeOrgEvents({
    url: 'http://api/v1/orgs/o1/events',
    getHandlers: () => handlers,
    onStatus,
    onInvalid,
    createEventSource: (url, init) => (source = new FakeEventSource(url, init)),
  });
  if (!source) throw new Error('no source');
  return { source, handlers, onStatus, onInvalid, unsubscribe };
}

describe('parseOrgEvent', () => {
  it('parses a valid event', () => {
    expect(parseOrgEvent('import.progress', JSON.stringify(progress))).toMatchObject({
      type: 'import.progress',
      data: { processed: 120 },
    });
  });

  it('rejects malformed JSON, schema violations and type mismatches', () => {
    expect(parseOrgEvent('import.progress', '{')).toBeNull();
    expect(parseOrgEvent('import.progress', JSON.stringify({ ...progress, data: {} }))).toBeNull();
    expect(parseOrgEvent('import.completed', JSON.stringify(progress))).toBeNull();
  });
});

describe('subscribeOrgEvents', () => {
  it('opens with credentials and dispatches typed events', () => {
    const { source, handlers, onStatus } = setup();
    expect(source.init).toEqual({ withCredentials: true });
    expect(onStatus).toHaveBeenLastCalledWith('connecting');
    source.onopen?.(new Event('open'));
    expect(onStatus).toHaveBeenLastCalledWith('open');
    source.emit('import.progress', progress);
    expect(handlers['import.progress']).toHaveBeenCalledWith(expect.objectContaining({ id: '17' }));
    expect(handlers['import.completed']).not.toHaveBeenCalled();
  });

  it('reports invalid messages instead of throwing', () => {
    const { source, onInvalid, handlers } = setup();
    source.emit('import.progress', 'not json');
    expect(onInvalid).toHaveBeenCalledWith('import.progress');
    expect(handlers['import.progress']).not.toHaveBeenCalled();
  });

  it('distinguishes reconnecting from closed', () => {
    const { source, onStatus } = setup();
    source.readyState = 0;
    source.onerror?.(new Event('error'));
    expect(onStatus).toHaveBeenLastCalledWith('reconnecting');
    source.readyState = 2;
    source.onerror?.(new Event('error'));
    expect(onStatus).toHaveBeenLastCalledWith('closed');
  });

  it('closes on unsubscribe', () => {
    const { source, unsubscribe } = setup();
    unsubscribe();
    expect(source.closed).toBe(true);
  });
});

describe('orgEventsUrl', () => {
  it('joins without a double slash and encodes the id', () => {
    expect(orgEventsUrl('http://localhost:4000/', 'a b')).toBe(
      'http://localhost:4000/v1/orgs/a%20b/events',
    );
  });
});
