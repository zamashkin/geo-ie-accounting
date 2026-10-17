// Who and what the public demo is (ADR 0016). Every person, company, address and account number
// here is made up; the IBANs use the check digits 00, which no real IBAN has.
import type { IsoDate, Period } from '@geo-ie-accounting/domain';

/**
 * The read-only demo login, shown on the sign-in page when `DEMO_MODE=true`. Public on purpose:
 * the API refuses every change it tries.
 */
export const DEMO_LOGIN = {
  email: 'demo@geo-ie-accounting.local',
  password: 'try-the-demo-2026',
  name: 'Demo Visitor',
} as const;

/**
 * Owner of the demo workspaces, who "did" the bookkeeping. The seed gives it a fresh random
 * password on every run and never prints it, so nobody signs in as it.
 */
export const DEMO_AUTHOR = {
  email: 'demo-owner@geo-ie-accounting.local',
  name: 'Nino Example',
} as const;

/** Bump when the generator changes what it books: a re-seed then rebuilds the workspaces. */
export const DEMO_GENERATOR_VERSION = 1;

export type Billing =
  /** A monthly fee: `baseMinor` ± up to `jitterMinor`. */
  | { kind: 'retainer'; baseMinor: bigint; jitterMinor: bigint; line: string }
  /** Hours × rate, with half hours. */
  | { kind: 'hourly'; rateMinor: bigint; minHours: number; maxHours: number; line: string }
  /** Some months only: a fixed-price feature plus support hours. */
  | {
      kind: 'project';
      chance: number;
      minMinor: bigint;
      maxMinor: bigint;
      hourlyMinor: bigint;
      features: readonly string[];
    };

export interface DemoClient {
  key: string;
  name: string;
  country: string;
  currency: 'USD' | 'EUR' | 'GBP';
  address: string;
  email: string;
  /** The payer as the bank prints it (`Sender:` in the statement). */
  sender: { name: string; address: string; account: string; bank: string };
  billing: Billing;
  /** First month invoiced. */
  from: Period;
  /** Days from the issue date to the payment: [min, max]. */
  payAfterDays: readonly [number, number];
}

export interface DemoWorkspace {
  key: string;
  name: string;
  /** The IE as the bank prints it. */
  statementOwner: string;
  bankClientCode: string;
  /** One IBAN for every currency, as Bank of Georgia does; the statement adds the currency. */
  iban: string;
  taxId: string;
  address: string;
  email: string;
  phone: string;
  invoicePrefix: string;
  invoiceNote: string;
  sbsEffectiveFrom: IsoDate;
  /** The first booked day. */
  startsOn: IsoDate;
  clients: readonly DemoClient[];
  /** Amount multiplier in percent, per year (100 = as listed). */
  scalePct: (year: number) => bigint;
  /** Owner draws per month: [min, max] in GEL tetri. */
  drawMinor: readonly [bigint, bigint];
  /**
   * The full story: invoices in every status, a late import refiled as a correction, a filed
   * month changed by a reversal, a cash receipt booked by hand, an unfinished import.
   */
  storyline: boolean;
}

const CLIENTS: readonly DemoClient[] = [
  {
    key: 'halcyon',
    name: 'Halcyon Data Systems Inc.',
    country: 'US',
    currency: 'USD',
    address: '100 Example Avenue, Suite 4, Austin, TX 73301, USA',
    email: 'billing@halcyon-data.example',
    sender: {
      name: 'HALCYON DATA SYSTEMS INC',
      address: '100 EXAMPLE AVENUE, AUSTIN TX,US',
      account: 'US00EXMP0000000000010001',
      bank: 'EXAMPLE NATIONAL BANK EXMPUS33',
    },
    billing: {
      kind: 'retainer',
      baseMinor: 420_000n,
      jitterMinor: 45_000n,
      line: 'Backend development retainer',
    },
    from: '2025-01',
    payAfterDays: [5, 16],
  },
  {
    key: 'kruemelwerk',
    name: 'Kruemelwerk Digital GmbH',
    country: 'DE',
    currency: 'EUR',
    address: 'Beispielstrasse 12, 10115 Berlin, Germany',
    email: 'rechnungen@kruemelwerk.example',
    sender: {
      name: 'KRUEMELWERK DIGITAL GMBH',
      address: 'BEISPIELSTRASSE 12, BERLIN,DE',
      account: 'DE00EXMP0000000000020002',
      bank: 'BEISPIELBANK AG EXMPDEFF',
    },
    billing: {
      kind: 'hourly',
      rateMinor: 5_500n,
      minHours: 24,
      maxHours: 46,
      line: 'Frontend development',
    },
    from: '2025-02',
    payAfterDays: [7, 20],
  },
  {
    key: 'bluefjord',
    name: 'Bluefjord Software Ltd',
    country: 'GB',
    currency: 'GBP',
    address: '7 Sample Lane, Bristol BS1 4AA, United Kingdom',
    email: 'accounts@bluefjord.example',
    sender: {
      name: 'BLUEFJORD SOFTWARE LTD',
      address: '7 SAMPLE LANE, BRISTOL,GB',
      account: 'GB00EXMP00000000030003',
      bank: 'SAMPLE BANK PLC EXMPGB2L',
    },
    billing: {
      kind: 'hourly',
      rateMinor: 4_800n,
      minHours: 12,
      maxHours: 30,
      line: 'Code review and pairing',
    },
    from: '2025-03',
    payAfterDays: [4, 12],
  },
  {
    key: 'lumen',
    name: 'Lumen Harbor LLC',
    country: 'US',
    currency: 'USD',
    address: '55 Placeholder Road, Portland, OR 97201, USA',
    email: 'ap@lumenharbor.example',
    sender: {
      name: 'LUMEN HARBOR LLC',
      address: '55 PLACEHOLDER ROAD, PORTLAND OR,US',
      account: 'US00EXMP0000000000040004',
      bank: 'PLACEHOLDER CREDIT UNION EXMPUS44',
    },
    billing: {
      kind: 'project',
      chance: 0.45,
      minMinor: 120_000n,
      maxMinor: 340_000n,
      hourlyMinor: 6_500n,
      features: [
        'Stripe billing integration',
        'Admin dashboard: reports module',
        'Mobile API: offline sync',
        'Data export to CSV and XLSX',
        'Single sign-on with SAML',
        'Search: indexing and ranking',
      ],
    },
    from: '2025-04',
    payAfterDays: [12, 34],
  },
  {
    key: 'vantablue',
    name: 'Vantablue Studio B.V.',
    country: 'NL',
    currency: 'EUR',
    address: 'Voorbeeldgracht 3, 1015 Amsterdam, Netherlands',
    email: 'finance@vantablue.example',
    sender: {
      name: 'VANTABLUE STUDIO BV',
      address: 'VOORBEELDGRACHT 3, AMSTERDAM,NL',
      account: 'NL00EXMP0000050005',
      bank: 'VOORBEELD BANK NV EXMPNL2A',
    },
    billing: {
      kind: 'project',
      chance: 0.35,
      minMinor: 90_000n,
      maxMinor: 260_000n,
      hourlyMinor: 6_000n,
      features: [
        'Design system: component library',
        'Marketing site performance pass',
        'Accessibility audit fixes',
        'Booking flow rewrite',
      ],
    },
    from: '2025-09',
    payAfterDays: [9, 25],
  },
];

export const DEMO_WORKSPACES: readonly DemoWorkspace[] = [
  {
    key: 'it-freelancer',
    name: 'Demo: IT freelancer',
    statementOwner: 'IE NINO EXAMPLE',
    bankClientCode: '10007770',
    iban: 'GE00BG0000000777000001',
    taxId: '01000777001',
    address: '1 Example Street, apt. 7, Tbilisi 0100, Georgia',
    email: 'nino@nino-example.example',
    phone: '+995 500 000 777',
    invoicePrefix: 'NE-',
    invoiceNote: 'Thank you! Payment by bank transfer to the account below.',
    // Registered as an IE in January 2025; the small-business status applies from 1 February.
    sbsEffectiveFrom: '2025-02-01',
    startsOn: '2025-01-13',
    clients: CLIENTS,
    scalePct: () => 100n,
    drawMinor: [220_000n, 420_000n],
    storyline: true,
  },
  {
    key: 'high-earner',
    name: 'Demo: high earner',
    statementOwner: 'IE GIORGI SAMPLE',
    bankClientCode: '10008880',
    iban: 'GE00BG0000000888000002',
    taxId: '01000888002',
    address: '2 Sample Avenue, Tbilisi 0102, Georgia',
    email: 'giorgi@giorgi-sample.example',
    phone: '+995 500 000 888',
    invoicePrefix: 'GS-',
    invoiceNote: 'Payment by bank transfer to the account below.',
    sbsEffectiveFrom: '2025-01-01',
    startsOn: '2025-01-06',
    clients: CLIENTS.filter((c) => c.key !== 'vantablue'),
    // A big 2025 (the annual limit is crossed mid-year), a calmer 2026.
    scalePct: (year) => (year === 2025 ? 420n : 130n),
    drawMinor: [1_200_000n, 2_600_000n],
    storyline: false,
  },
];
