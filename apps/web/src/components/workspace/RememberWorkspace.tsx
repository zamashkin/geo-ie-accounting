'use client';

import { useEffect } from 'react';
import { lastOrgCookie } from '@/lib/workspace';

/** Remembers the open workspace so `/` reopens it next time. Renders nothing. */
export function RememberWorkspace({ orgId }: { orgId: string }) {
  useEffect(() => {
    document.cookie = lastOrgCookie(orgId, window.location.protocol === 'https:');
  }, [orgId]);
  return null;
}
