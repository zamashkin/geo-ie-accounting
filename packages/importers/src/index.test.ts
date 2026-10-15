import { describe, expect, it } from 'vitest';
import { parsers } from './index';

describe('importers', () => {
  it('starts with no registered parsers (WS-03 adds them)', () => {
    expect(parsers).toEqual([]);
  });
});
