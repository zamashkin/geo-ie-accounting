import { describe, expect, it } from 'vitest';
import { POSTING_SIGN } from './index';

describe('domain', () => {
  it('debits are positive and credits negative', () => {
    expect(POSTING_SIGN.debit + POSTING_SIGN.credit).toBe(0n);
  });
});
