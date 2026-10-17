'use client';

import { Button, Card, Stepper, TextField } from '@geo-ie-accounting/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormAlert } from '@/components/form-helpers';
import { SbsDateForm } from '@/components/workspace/SbsDateForm';
import { isApiError } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import { createOrganization } from '@/lib/api/ledger';
import { NEW_ORG_PATH, orgHref } from '@/lib/nav';

const STEPS = [
  { id: 'workspace', label: 'Workspace', description: 'Name it' },
  { id: 'sbs', label: 'Small-business status', description: 'When your status began' },
] as const;

function CreateStep({ firstRun }: { firstRun: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One key per attempt of this form: a double submit replays instead of creating two.
  const [key, setKey] = useState(newIdempotencyKey);

  async function submit() {
    setFormError(null);
    if (name.trim() === '') {
      setNameError('Enter a name for the workspace');
      return;
    }
    setNameError(null);
    setPending(true);
    try {
      const org = await createOrganization({ name: name.trim() }, key);
      router.replace(`${NEW_ORG_PATH}?org=${org.id}` as Route);
      router.refresh();
    } catch (err) {
      setPending(false);
      setKey(newIdempotencyKey());
      const field = isApiError(err) ? err.fieldErrors()['name'] : undefined;
      if (field) setNameError(field);
      else setFormError(isApiError(err) ? (err.problem.detail ?? err.problem.title) : String(err));
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <TextField
        label="Workspace name"
        description="Usually your name as an individual entrepreneur, e.g. “Nino Beridze IE”."
        value={name}
        onChange={setName}
        isRequired
        isInvalid={nameError !== null}
        errorMessage={nameError ?? ''}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" isPending={pending}>
          Create workspace
        </Button>
        {firstRun ? null : (
          <Button
            variant="ghost"
            onPress={() => {
              router.back();
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function NewOrgFlow({
  firstRun,
  created,
}: {
  firstRun: boolean;
  created: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const step = created ? 'sbs' : 'workspace';

  function finish() {
    if (!created) return;
    router.push(orgHref(created.id) as Route);
    router.refresh();
  }

  return (
    <Card className="flex flex-col gap-6 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {firstRun && !created ? 'Set up your workspace' : 'New workspace'}
        </h1>
        <p className="text-sm text-fg-muted">
          {created
            ? `“${created.name}” is ready. One more detail for the declarations.`
            : 'A workspace holds one entrepreneur’s accounts, imports and declarations.'}
        </p>
      </div>
      <Stepper steps={STEPS} currentStepId={step} label="Workspace setup" />
      {created ? (
        <SbsDateForm
          orgId={created.id}
          initial={null}
          submitLabel="Save and continue"
          onSaved={finish}
          secondaryAction={
            <Button variant="ghost" onPress={finish}>
              Skip for now
            </Button>
          }
        />
      ) : (
        <CreateStep firstRun={firstRun} />
      )}
      {created ? (
        <p className="text-xs text-fg-muted">
          You can change the date later in{' '}
          <Link
            href={orgHref(created.id, '/settings') as Route}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            workspace settings
          </Link>
          .
        </p>
      ) : null}
    </Card>
  );
}
