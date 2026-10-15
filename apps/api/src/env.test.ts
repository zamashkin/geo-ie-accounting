import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    expect(env.PORT).toBe(4000);
    expect(env.LOG_PRETTY).toBe(false);
  });

  it('fails fast listing the invalid variables', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(
      /DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/,
    );
  });
});
