'use client';

import { useEffect, useRef, useState } from 'react';
import { publicEnv } from '../public-env';
import {
  type ConnectionStatus,
  type EventSourceFactory,
  type OrgEventHandlers,
  orgEventsUrl,
  subscribeOrgEvents,
} from './org-events';

export interface UseOrgEventsOptions {
  /** Pause the stream (e.g. no import running). Default true. */
  enabled?: boolean;
  createEventSource?: EventSourceFactory;
}

/**
 * Typed server events for one org (contracts `OrgEvent`). Handlers may change every render
 * without reconnecting.
 *
 *   const status = useOrgEvents(orgId, {
 *     'import.progress': (e) => setProgress(e.data.processed),
 *     'import.completed': () => queryClient.invalidateQueries({ queryKey: ['imports', orgId] }),
 *   });
 */
export function useOrgEvents(
  orgId: string,
  handlers: OrgEventHandlers,
  { enabled = true, createEventSource }: UseOrgEventsOptions = {},
): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('closed');
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    return subscribeOrgEvents({
      url: orgEventsUrl(publicEnv().apiUrl, orgId),
      getHandlers: () => handlersRef.current,
      onStatus: setStatus,
      ...(createEventSource ? { createEventSource } : {}),
    });
  }, [orgId, enabled, createEventSource]);

  return enabled ? status : 'closed';
}
