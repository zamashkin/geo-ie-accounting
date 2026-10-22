import 'server-only';
import type { MeResponse } from '@geo-ie-accounting/contracts';
import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { signInHref } from './next-path';
import { REQUEST_PATH_HEADER } from './request-path';
import { getSession } from './server';

/**
 * The session, or a redirect to sign-in that returns to the page asked for. proxy.ts passes
 * the full path (with the query) along; `fallbackPath` is used when it did not run.
 */
export async function requireSession(fallbackPath: string): Promise<MeResponse> {
  const session = await getSession();
  if (session) return session;
  const path = (await headers()).get(REQUEST_PATH_HEADER) ?? fallbackPath;
  redirect(signInHref(path) as Route);
}
