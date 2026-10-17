import type { HealthResponse } from '@geo-ie-accounting/contracts';

export type HealthResult =
  | { kind: 'ok'; body: HealthResponse }
  | { kind: 'degraded'; body: HealthResponse }
  | { kind: 'unreachable'; reason: string };

export interface HealthView {
  tone: 'ok' | 'warn' | 'down';
  label: string;
  detail: string | null;
}

export function describeHealth(result: HealthResult): HealthView {
  switch (result.kind) {
    case 'ok':
      return { tone: 'ok', label: 'Healthy', detail: `API ${result.body.version}, database ok` };
    case 'degraded':
      return {
        tone: 'warn',
        label: 'Degraded',
        detail: `Database check: ${result.body.checks.database}`,
      };
    case 'unreachable':
      return { tone: 'down', label: 'Unreachable', detail: result.reason };
  }
}
