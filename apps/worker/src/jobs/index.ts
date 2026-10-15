import type { JobDefinition } from './define';
import { noopJob } from './noop';

// Workstreams add their jobs here (rates in WS-02, imports in WS-07, ...).
export const jobs: readonly JobDefinition[] = [noopJob];
