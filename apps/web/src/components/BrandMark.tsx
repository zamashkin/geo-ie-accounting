import Link from 'next/link';

/** Product mark: a small ledger glyph and the name. */
export function BrandMark({ href = '/' }: { href?: '/' }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 self-start rounded-md text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-fg"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M4 3.5h9.5L16 6v10.5H4z" strokeLinejoin="round" />
          <path d="M7 8.5h6M7 11.5h6M7 14.5h3.5" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-base font-semibold tracking-tight">IE Ledger</span>
    </Link>
  );
}
