// packages/nbg: NBG exchange-rate client. WS-02 implements it (SPEC §2.3).

/** Rates endpoint checked on 2026-10-15. Query: `?currencies=USD&date=YYYY-MM-DD`. */
export const NBG_RATES_ENDPOINT =
  'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/' as const;
