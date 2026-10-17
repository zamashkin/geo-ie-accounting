'use client';

import { Select } from '@geo-ie-accounting/ui';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** Year switcher for year-scoped pages; the year lives in `?year=`. */
export function YearPicker({ year, years }: { year: number; years: readonly number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  return (
    <Select
      aria-label="Year"
      className="w-28"
      options={years.map((y) => ({ id: String(y), label: String(y) }))}
      value={String(year)}
      isDisabled={isPending}
      onChange={(value) => {
        if (!value || value === String(year)) return;
        startTransition(() => {
          router.push(`${pathname}?year=${value}` as Route);
        });
      }}
    />
  );
}
