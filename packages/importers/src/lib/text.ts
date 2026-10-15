// Byte -> text decoding and small string helpers shared by the parsers.

export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
  /** True when the bytes were not valid UTF-8 and we fell back to windows-1252. */
  fallback: boolean;
}

/**
 * Decodes statement bytes. Honours a UTF-8/UTF-16 BOM (and strips it); otherwise tries strict
 * UTF-8 and falls back to windows-1252, which maps every byte, so decoding never fails.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder('utf-8').decode(bytes.subarray(3)),
      encoding: 'utf-8',
      fallback: false,
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf-16le',
      fallback: false,
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'utf-16be',
      fallback: false,
    };
  }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'utf-8',
      fallback: false,
    };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'windows-1252',
      fallback: true,
    };
  }
}

/** True if the bytes contain NUL or many control characters, i.e. are not a text file. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i] ?? 0;
    if (b === 0) return true;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control++;
  }
  return n > 0 && control / n > 0.05;
}

/** Folds line breaks (and the tabs/spaces BoG indents continuation lines with) into one space. */
export function collapseLines(s: string): string {
  return s.replace(/[ \t]*(?:\r\n|\r|\n)[ \t]*/g, ' ').trim();
}

/** Trim + collapse inner runs of whitespace + lower case: for matching labels and headers. */
export function normaliseLabel(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/:$/, '').trim().toLowerCase();
}

/** SWIFT MT fields carry text in lines of at most 35 characters. */
const SWIFT_LINE = 35;

/**
 * BoG joins SWIFT 35-character lines with `\` (FORMAT.md). A party field is "name\address...".
 * Returns the name: the first line, continued while a line is exactly 35 characters long, since a
 * full line means the name was cut mid-text (`PETROV NIKOLAI SERGEEVICH PETROV NI\KOLAI ...`).
 * `\` is never an escape character.
 */
export function swiftName(field: string): string {
  const lines = field.split('\\');
  let name = lines[0] ?? '';
  let last = name;
  for (let i = 1; i < lines.length && last.length === SWIFT_LINE; i++) {
    last = lines[i] ?? '';
    name += last;
  }
  return name.trim();
}

/** Empty or whitespace-only string -> null, otherwise the trimmed string. */
export function blankToNull(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t === '' ? null : t;
}
