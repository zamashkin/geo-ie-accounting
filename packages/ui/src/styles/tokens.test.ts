import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function declarations(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/(--ui-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [
      m[1] ?? '',
      (m[2] ?? '').trim(),
    ]),
  );
}

function blockAfter(marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`missing ${marker}`);
  const open = css.indexOf('{', start + marker.length);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(open, i);
  }
  throw new Error('unbalanced');
}

describe('design tokens', () => {
  const light = declarations(blockAfter(':root {'));
  const darkByMedia = declarations(blockAfter('@media (prefers-color-scheme: dark)'));
  const darkByAttr = declarations(blockAfter(":root[data-theme='dark']"));

  it('keeps the two dark palettes identical', () => {
    expect(Object.fromEntries(darkByMedia)).toEqual(Object.fromEntries(darkByAttr));
  });

  it('gives every colour token a dark value', () => {
    const colourTokens = [...light.keys()].filter((k) => !/radius|font|sidebar|topbar/.test(k));
    const missing = colourTokens.filter((k) => !darkByAttr.has(k));
    expect(missing).toEqual([]);
  });
});
