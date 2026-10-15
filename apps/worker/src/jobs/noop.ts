import { defineJob } from './define';

/** Does nothing but log. Proves the queue round-trip works. */
export const noopJob = defineJob({
  name: 'noop',
  handler: async (payload, { log }) => {
    log.info({ message: payload.message ?? null }, 'noop job handled');
  },
});
