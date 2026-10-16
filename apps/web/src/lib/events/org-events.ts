import { OrgEvent, type OrgEventOf, type OrgEventType } from '@ie-ledger/contracts';

// Client side of ADR 0005: one EventSource per org on GET /v1/orgs/:orgId/events.
// The SSE `event:` field is the event type, `data:` is the JSON of the whole event, `id:` is
// used by the browser for Last-Event-ID on reconnect (EventSource reconnects by itself).

export const ORG_EVENT_TYPES = [
  'import.progress',
  'import.completed',
  'rates.backfilled',
  'invoice.pdf_ready',
] as const satisfies readonly OrgEventType[];

export type OrgEventHandlers = {
  [T in OrgEventType]?: (event: OrgEventOf<T>) => void;
};

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Parses one SSE message. Returns null (and never throws) for malformed or mismatched data. */
export function parseOrgEvent(type: string, data: string): OrgEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = OrgEvent.safeParse(json);
  if (!parsed.success || parsed.data.type !== type) return null;
  return parsed.data;
}

export function orgEventsUrl(apiUrl: string, orgId: string): string {
  return `${apiUrl.replace(/\/$/, '')}/v1/orgs/${encodeURIComponent(orgId)}/events`;
}

/** The subset of EventSource used here, so tests can pass a fake. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void;
  close(): void;
}
export type EventSourceFactory = (url: string, init: EventSourceInit) => EventSourceLike;

const CLOSED = 2;

export interface SubscribeOptions {
  url: string;
  /** Read on every message, so callers can swap handlers without reconnecting. */
  getHandlers: () => OrgEventHandlers;
  onStatus?: (status: ConnectionStatus) => void;
  /** Reports messages that failed validation (contract drift). */
  onInvalid?: (type: string) => void;
  createEventSource?: EventSourceFactory;
}

/** Opens the stream and dispatches typed events. Returns an unsubscribe function. */
export function subscribeOrgEvents({
  url,
  getHandlers,
  onStatus,
  onInvalid,
  createEventSource = (u, init) => new EventSource(u, init),
}: SubscribeOptions): () => void {
  onStatus?.('connecting');
  const source = createEventSource(url, { withCredentials: true });
  source.onopen = () => onStatus?.('open');
  source.onerror = () => {
    // CLOSED means the browser gave up (e.g. 401/403/404); otherwise it is retrying.
    onStatus?.(source.readyState === CLOSED ? 'closed' : 'reconnecting');
  };
  for (const type of ORG_EVENT_TYPES) {
    source.addEventListener(type, (message) => {
      const event = parseOrgEvent(type, message.data);
      if (!event) {
        onInvalid?.(type);
        return;
      }
      const handler = getHandlers()[event.type] as ((e: OrgEvent) => void) | undefined;
      handler?.(event);
    });
  }
  return () => {
    source.close();
    onStatus?.('closed');
  };
}
