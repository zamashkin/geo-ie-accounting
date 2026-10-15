import { describe, expect, it } from 'vitest';
import { NBG_RATES_ENDPOINT } from './index';

describe('nbg', () => {
  it('points at the NBG HTTPS endpoint', () => {
    expect(new URL(NBG_RATES_ENDPOINT).protocol).toBe('https:');
  });
});
