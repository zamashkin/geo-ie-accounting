'use client';

import type { DemoLogin } from '@geo-ie-accounting/contracts';
import { Button, Card } from '@geo-ie-accounting/ui';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormAlert } from '@/components/form-helpers';
import { errorMessage } from '@/lib/api/api-error';
import { authClient } from '@/lib/auth/client';

/** "Try the demo": signs in with the read-only demo login the API publishes (`DEMO_MODE`). */
export function DemoSignIn({ login, next }: { login: DemoLogin; next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tryDemo() {
    setPending(true);
    setError(null);
    try {
      await authClient().signIn({ email: login.email, password: login.password });
      router.replace(next as Route);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-5 sm:p-6">
      <h2 className="text-base font-semibold tracking-tight">Try the demo</h2>
      <p className="text-sm text-fg-muted">
        A read-only workspace with almost two years of made-up bookkeeping for an IT freelancer:
        imports, invoices, filed returns and one that needs a correction.
      </p>
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Button variant="secondary" isPending={pending} onPress={() => void tryDemo()}>
        Try the demo
      </Button>
      <p className="text-xs text-fg-muted">
        Or sign in as <code className="font-mono">{login.email}</code> /{' '}
        <code className="font-mono">{login.password}</code>.
      </p>
    </Card>
  );
}
