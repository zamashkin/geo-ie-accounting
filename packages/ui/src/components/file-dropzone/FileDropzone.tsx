'use client';

import { FileSpreadsheet, UploadCloud, X } from 'lucide-react';
import { useId, useState } from 'react';
import {
  Button as AriaButton,
  DropZone,
  type DropItem,
  FileTrigger,
  Text,
} from 'react-aria-components';
import { cx } from '../../lib/cx';
import { buttonClass } from '../button/Button';
import { closeButtonClass } from '../dialog/Dialog';

export interface FileDropzoneProps {
  /** Visible label, also the drop target's accessible name. */
  label: string;
  /** Extensions (".csv") and/or MIME types ("text/csv"). Empty = anything. */
  accept?: readonly string[];
  /** Largest file accepted, in bytes. */
  maxSizeBytes?: number;
  allowsMultiple?: boolean;
  /** Selected files (controlled). */
  value: readonly File[];
  onChange: (files: File[]) => void;
  description?: string;
  /** Error from outside (e.g. the upload failed). Local rejections are shown automatically. */
  errorMessage?: string | undefined;
  isDisabled?: boolean;
  className?: string;
}

export function fileMatches(
  file: { name: string; type: string },
  accept: readonly string[],
): boolean {
  if (accept.length === 0) return true;
  const name = file.name.toLowerCase();
  return accept.some((rule) => {
    const r = rule.toLowerCase();
    if (r.startsWith('.')) return name.endsWith(r);
    if (r.endsWith('/*')) return file.type.startsWith(r.slice(0, -1));
    return file.type === r;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit] ?? 'GB'}`;
}

/**
 * Drop target plus a "Choose file" button (the keyboard and screen-reader path).
 * Files are checked against `accept` and `maxSizeBytes` before `onChange` sees them.
 */
export function FileDropzone({
  label,
  accept = [],
  maxSizeBytes,
  allowsMultiple = false,
  value,
  onChange,
  description,
  errorMessage,
  isDisabled = false,
  className,
}: FileDropzoneProps) {
  const [rejection, setRejection] = useState<string | null>(null);
  const labelId = useId();
  const descriptionId = useId();
  const errorId = useId();

  function take(files: File[]) {
    const problems: string[] = [];
    const ok = files.filter((f) => {
      if (!fileMatches(f, accept)) {
        problems.push(`${f.name} is not a supported file type`);
        return false;
      }
      if (maxSizeBytes !== undefined && f.size > maxSizeBytes) {
        problems.push(`${f.name} is larger than ${formatBytes(maxSizeBytes)}`);
        return false;
      }
      return true;
    });
    setRejection(problems.length > 0 ? problems.join('. ') : null);
    if (ok.length === 0) return;
    onChange(allowsMultiple ? [...value, ...ok] : ok.slice(0, 1));
  }

  async function onDrop(items: DropItem[]) {
    const files = await Promise.all(
      items.flatMap((item) => (item.kind === 'file' ? [item.getFile()] : [])),
    );
    take(files);
  }

  const error = errorMessage ?? rejection;
  const describedBy = cx(description && descriptionId, error && errorId);
  const hint = [
    accept.length > 0
      ? accept
          .filter((a) => a.startsWith('.'))
          .join(', ')
          .toUpperCase()
      : null,
    maxSizeBytes !== undefined ? `up to ${formatBytes(maxSizeBytes)}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <span id={labelId} className="text-sm font-medium text-fg">
        {label}
      </span>
      <DropZone
        aria-labelledby={labelId}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        isDisabled={isDisabled}
        // Browsers hide file names and often MIME types until the drop, so accept the drag
        // and check each file in `take`, which explains any rejection.
        getDropOperation={() => 'copy'}
        onDrop={(e) => void onDrop(e.items)}
        className={cx(
          'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-line-strong/50 bg-surface px-6 py-8 text-center transition-colors',
          'data-[drop-target]:border-accent data-[drop-target]:bg-accent-soft',
          'data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus',
          error && 'border-negative/60',
          isDisabled && 'opacity-60',
        )}
      >
        {({ isDropTarget }) => (
          <>
            <UploadCloud aria-hidden className="size-8 text-fg-muted" />
            <Text slot="label" className="text-sm text-fg">
              {isDropTarget ? 'Drop to add' : 'Drag a file here, or'}
            </Text>
            <FileTrigger
              {...(accept.length > 0 ? { acceptedFileTypes: [...accept] } : {})}
              allowsMultiple={allowsMultiple}
              onSelect={(list) => {
                if (list) take(Array.from(list));
              }}
            >
              <AriaButton
                isDisabled={isDisabled}
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
              >
                Choose file
              </AriaButton>
            </FileTrigger>
            {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
          </>
        )}
      </DropZone>
      {description ? (
        <p id={descriptionId} className="text-xs text-fg-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-negative-fg">
          {error}
        </p>
      ) : null}
      {value.length > 0 ? (
        <ul aria-label="Selected files" className="flex flex-col gap-2">
          {value.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2"
            >
              <FileSpreadsheet aria-hidden className="size-5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{file.name}</span>
                <span className="block text-xs text-fg-muted">{formatBytes(file.size)}</span>
              </span>
              <AriaButton
                aria-label={`Remove ${file.name}`}
                className={closeButtonClass}
                onPress={() => onChange(value.filter((_, i) => i !== index))}
              >
                <X aria-hidden className="size-4" />
              </AriaButton>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
