import type { Schemas } from './api/client';
import { formatMinor } from './format';

type Rule = Schemas['CategorizationRule'];

/** One line per rule: `Counterparty contains “acme” · money in · GBP 10.00 – 500.00`. */
export function describeConditions(rule: Rule): string {
  const parts: string[] = [];
  if (rule.counterpartyContains) parts.push(`Counterparty contains “${rule.counterpartyContains}”`);
  if (rule.descriptionContains) parts.push(`Details contain “${rule.descriptionContains}”`);
  if (rule.direction) parts.push(rule.direction === 'in' ? 'Money in' : 'Money out');
  if (rule.currency) {
    const { amountMinMinor: min, amountMaxMinor: max, currency } = rule;
    if (min !== null && max !== null) {
      parts.push(
        `${formatMinor(min, currency)} – ${formatMinor(max, currency, { display: 'none' })}`,
      );
    } else if (min !== null) {
      parts.push(`At least ${formatMinor(min, currency)}`);
    } else if (max !== null) {
      parts.push(`At most ${formatMinor(max, currency)}`);
    } else {
      parts.push(`In ${currency}`);
    }
  }
  return parts.join(' · ');
}
