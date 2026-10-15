import { bigint, char, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/** Primary key: UUID v7 generated in the app (time-ordered, index friendly). */
export const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Money: signed minor units. Always `mode: 'bigint'`; never a JS number. */
export const minor = (name: string) => bigint(name, { mode: 'bigint' });

/** ISO 4217 code. */
export const currency = (name = 'currency') => char(name, { length: 3 });
