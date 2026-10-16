'use client';

import { Button, DatePicker } from '@ie-ledger/ui';
import { type ReactNode, useState } from 'react';
import { FormAlert } from '@/components/form-helpers';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import { updateOrganization } from '@/lib/api/ledger';

/**
 * The small-business status start date (`sbsEffectiveFrom`). Owners only: the API answers 403
 * for anyone else. Income booked before the date is not declared.
 */
export function SbsDateForm({
  orgId,
  initial,
  onSaved,
  submitLabel = 'Save',
  secondaryAction,
}: {
  orgId: string;
  initial: string | null;
  onSaved: (value: string | null) => void;
  submitLabel?: string;
  secondaryAction?: ReactNode;
}) {
  const [value, setValue] = useState<string | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setError(null);
    setPending(true);
    try {
      const org = await updateOrganization(orgId, { sbsEffectiveFrom: value }, newIdempotencyKey());
      onSaved(org.sbsEffectiveFrom);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error ? <FormAlert>{error}</FormAlert> : null}
      <DatePicker
        label="Small-business status start date"
        description="The date on your small-business status certificate (rs.ge). Income before it is not declared. Leave empty if you have no status yet."
        value={value}
        onChange={setValue}
        minValue="2000-01-01"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" isPending={pending}>
          {submitLabel}
        </Button>
        {value !== null ? (
          <Button
            variant="ghost"
            onPress={() => {
              setValue(null);
            }}
          >
            Clear date
          </Button>
        ) : null}
        {secondaryAction}
      </div>
    </form>
  );
}
