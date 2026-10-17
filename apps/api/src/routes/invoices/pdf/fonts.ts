// Fonts embedded in invoice PDFs: Noto Sans for Latin and Cyrillic, Noto Sans Georgian for
// Georgian script (assets/fonts, SIL OFL 1.1). Registered once per process.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Font } from '@react-pdf/renderer';

/** Text style for every node: Latin first, Georgian glyphs fall back to Noto Sans Georgian. */
export const FONT_FAMILY = ['NotoSans', 'NotoSansGeorgian'];

/**
 * `apps/api/assets/fonts`: four levels up from this file under `tsx` (src/routes/invoices/pdf),
 * one level up from the esbuild bundle (dist/main.js). `GEO_IE_ACCOUNTING_FONT_DIR` overrides both.
 */
function fontDir(): string {
  const override = process.env.GEO_IE_ACCOUNTING_FONT_DIR;
  if (override) return override;
  const candidates = ['../../../../assets/fonts/', '../assets/fonts/'].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  );
  const found = candidates.find((dir) => existsSync(`${dir}NotoSans-Regular.ttf`));
  if (!found) throw new Error(`invoice fonts not found in ${candidates.join(' or ')}`);
  return found;
}

let registered = false;

export function registerInvoiceFonts() {
  if (registered) return;
  const dir = fontDir();
  Font.register({
    family: 'NotoSans',
    fonts: [
      { src: `${dir}NotoSans-Regular.ttf`, fontWeight: 'normal' },
      { src: `${dir}NotoSans-Bold.ttf`, fontWeight: 'bold' },
    ],
  });
  Font.register({
    family: 'NotoSansGeorgian',
    fonts: [
      { src: `${dir}NotoSansGeorgian-Regular.ttf`, fontWeight: 'normal' },
      { src: `${dir}NotoSansGeorgian-Bold.ttf`, fontWeight: 'bold' },
    ],
  });
  // Words are never hyphenated: names, IBANs and Georgian text break only at spaces.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
