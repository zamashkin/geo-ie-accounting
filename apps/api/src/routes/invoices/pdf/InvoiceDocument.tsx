// The invoice PDF (@react-pdf/renderer). Pure layout: every figure comes from the InvoiceView
// (totals from packages/domain), amounts are formatted by packages/domain/format.ts.
import type { InvoiceParty, InvoiceView } from '@ie-ledger/contracts';
import { formatAmount, formatMoney } from '@ie-ledger/domain';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { FONT_FAMILY } from './fonts';

const INK = '#1a1d23';
const MUTED = '#5f6672';
const LINE = '#d9dce1';
const ACCENT = '#1f5f8b';
const SOFT = '#f3f5f8';

const s = StyleSheet.create({
  page: {
    fontFamily: FONT_FAMILY,
    fontSize: 9.5,
    color: INK,
    paddingTop: 44,
    paddingBottom: 56,
    paddingHorizontal: 48,
    lineHeight: 1.35,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  title: { fontSize: 24, lineHeight: 1.2, fontWeight: 'bold', color: ACCENT, letterSpacing: 1 },
  number: { fontSize: 11, marginTop: 4, color: MUTED },
  seller: { width: '50%', alignItems: 'flex-end', textAlign: 'right' },
  sellerName: { fontSize: 11, fontWeight: 'bold', marginBottom: 2 },
  muted: { color: MUTED },
  mark: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderRadius: 2,
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  meta: { flexDirection: 'row', marginBottom: 24, gap: 24 },
  billTo: { flexGrow: 1, flexBasis: 0 },
  facts: { width: 190 },
  label: {
    fontSize: 7.5,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  clientName: { fontSize: 11, fontWeight: 'bold', marginBottom: 2 },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
  },
  table: { borderTopWidth: 1, borderTopColor: INK },
  th: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    fontSize: 7.5,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tr: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
  },
  cDesc: { flexGrow: 1, flexBasis: 0, paddingRight: 8 },
  cQty: { width: 50, textAlign: 'right' },
  cPrice: { width: 90, textAlign: 'right' },
  cAmount: { width: 100, textAlign: 'right' },
  totals: { marginTop: 10, alignSelf: 'flex-end', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: SOFT,
    fontSize: 11,
    fontWeight: 'bold',
  },
  section: { marginTop: 26 },
  bankBox: {
    padding: 10,
    borderWidth: 0.5,
    borderColor: LINE,
    borderRadius: 3,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  bankItem: { width: '50%', marginBottom: 6 },
  mono: { letterSpacing: 0.4 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: MUTED,
  },
});

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function formatDate(date: string | null): string {
  return date ? dateFormat.format(new Date(`${date}T00:00:00Z`)) : '—';
}

function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "GE29NB0000000101904917" → "GE29 NB00 0000 0101 9049 17". */
function groupIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, '$1 ');
}

function Lines({ children }: { children: (string | null | false | undefined)[] }) {
  return (
    <>
      {children
        .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
        .flatMap((c) => c.split('\n'))
        .map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
    </>
  );
}

function Party({ party, align }: { party: InvoiceParty; align?: 'right' }) {
  return (
    <View style={align === 'right' ? { alignItems: 'flex-end' } : {}}>
      <Lines>
        {[
          party.address,
          party.country && party.country !== 'GE' ? countryName(party.country) : null,
          party.taxId ? `Tax ID ${party.taxId}` : null,
          party.email,
          party.phone,
        ]}
      </Lines>
    </View>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={s.factRow}>
      <Text style={s.muted}>{label}</Text>
      <Text>{children}</Text>
    </View>
  );
}

export function InvoiceDocument({ invoice }: { invoice: InvoiceView }) {
  const { seller, client, bank, note } = invoice.parties;
  const money = (minor: bigint) =>
    formatMoney({ amountMinor: minor, currency: invoice.currency }, 'en', {
      currencyDisplay: 'code',
    });
  const amount = (minor: bigint) =>
    formatAmount({ amountMinor: minor, currency: invoice.currency });
  const title = invoice.number ? `Invoice ${invoice.number}` : 'Draft invoice';
  const mark =
    invoice.status === 'draft'
      ? { text: 'DRAFT', color: MUTED }
      : invoice.status === 'void'
        ? { text: 'VOID', color: '#b42318' }
        : invoice.status === 'paid'
          ? { text: 'PAID', color: '#18794e' }
          : null;

  return (
    <Document
      title={title}
      author={seller.name}
      subject={`${title} to ${client.name}`}
      creator="IE Ledger"
      producer="IE Ledger"
    >
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>INVOICE</Text>
            <Text style={s.number}>
              {invoice.number ? `No. ${invoice.number}` : 'Not issued yet'}
            </Text>
            {mark ? (
              <Text style={[s.mark, { color: mark.color, borderColor: mark.color }]}>
                {mark.text}
              </Text>
            ) : null}
          </View>
          <View style={s.seller}>
            <Text style={s.sellerName}>{seller.name}</Text>
            <Party party={seller} align="right" />
          </View>
        </View>

        <View style={s.meta}>
          <View style={s.billTo}>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.clientName}>{client.name}</Text>
            <Party party={client} />
          </View>
          <View style={s.facts}>
            <Fact label="Issue date">{formatDate(invoice.issueDate)}</Fact>
            <Fact label="Due date">{formatDate(invoice.dueDate)}</Fact>
            <Fact label="Currency">{invoice.currency}</Fact>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.th} fixed>
            <Text style={s.cDesc}>Description</Text>
            <Text style={s.cQty}>Qty</Text>
            <Text style={s.cPrice}>Unit price</Text>
            <Text style={s.cAmount}>Amount</Text>
          </View>
          {invoice.lines.map((line) => (
            <View key={line.id} style={s.tr} wrap={false}>
              <Text style={s.cDesc}>{line.description}</Text>
              <Text style={s.cQty}>{line.quantity}</Text>
              <Text style={s.cPrice}>{amount(line.unitPriceMinor)}</Text>
              <Text style={s.cAmount}>{amount(line.lineTotalMinor)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals} wrap={false}>
          {invoice.paidMinor > 0n ? (
            <>
              <View style={s.totalRow}>
                <Text style={s.muted}>Total</Text>
                <Text>{money(invoice.totalMinor)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text style={s.muted}>Paid</Text>
                <Text>−{money(invoice.paidMinor)}</Text>
              </View>
              <View style={s.grand}>
                <Text>Balance due</Text>
                <Text>{money(invoice.outstandingMinor)}</Text>
              </View>
            </>
          ) : (
            <View style={s.grand}>
              <Text>Total due</Text>
              <Text>{money(invoice.totalMinor)}</Text>
            </View>
          )}
        </View>

        {bank ? (
          <View style={s.section} wrap={false}>
            <Text style={s.label}>Payment details</Text>
            <View style={s.bankBox}>
              <View style={s.bankItem}>
                <Text style={s.muted}>Beneficiary</Text>
                <Text>{seller.name}</Text>
              </View>
              {bank.bank ? (
                <View style={s.bankItem}>
                  <Text style={s.muted}>Bank</Text>
                  <Text>{bank.bank}</Text>
                </View>
              ) : null}
              {bank.iban ? (
                <View style={s.bankItem}>
                  <Text style={s.muted}>IBAN</Text>
                  <Text style={s.mono}>{groupIban(bank.iban)}</Text>
                </View>
              ) : null}
              <View style={s.bankItem}>
                <Text style={s.muted}>Reference</Text>
                <Text>{invoice.number ?? 'Invoice number'}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {invoice.notes ? (
          <View style={s.section} wrap={false}>
            <Text style={s.label}>Notes</Text>
            <Lines>{[invoice.notes]}</Lines>
          </View>
        ) : null}

        {note ? (
          <View style={s.section} wrap={false}>
            <Lines>{[note]}</Lines>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>
            {seller.name}
            {seller.taxId ? ` · Tax ID ${seller.taxId}` : ''}
          </Text>
          <Text>{title}</Text>
        </View>
      </Page>
    </Document>
  );
}
