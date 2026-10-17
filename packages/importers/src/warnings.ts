import type { ParseWarning, ParseWarningCode } from '@geo-ie-accounting/contracts';

// The warning catalogue lives in contracts (`PARSE_WARNING_CODES`, one comment per code).
// Messages never include statement contents (names, IBANs, amounts): warnings may end up in logs.
// They point at a statement row (`rowIndex`) or name a file line / sheet row in the message.

export type WarningCode = ParseWarningCode;

/** Collects warnings for one parse. */
export class Warnings {
  readonly list: ParseWarning[] = [];

  add(code: WarningCode, message: string, rowIndex: number | null = null): void {
    this.list.push({ code, message, rowIndex });
  }
}
