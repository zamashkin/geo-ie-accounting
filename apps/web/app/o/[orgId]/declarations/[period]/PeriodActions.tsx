'use client';

import { Button, Dialog, DialogFooter, TextField, toast } from '@ie-ledger/ui';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy, FileCheck2, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Notice } from '@/components/Notice';
import { errorMessage } from '@/lib/api/api-error';
import { newIdempotencyKey } from '@/lib/api/browser';
import { fileDeclaration } from '@/lib/api/declarations';

/** Copies one figure, as rs.ge expects it typed: `5698.66`, no grouping, no currency. */
export function CopyFigure({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="print:hidden"
      aria-label={`Copy ${label}: ${value}`}
      onPress={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1500);
          },
          () => {
            toast({ title: 'Could not copy', description: value, tone: 'negative' });
          },
        );
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function PrintButton() {
  return (
    <Button
      variant="secondary"
      className="print:hidden"
      onPress={() => {
        window.print();
      }}
    >
      <Printer aria-hidden />
      Print
    </Button>
  );
}

/**
 * Records the filing on rs.ge: an immutable snapshot of today's live figures. With a previous
 * filing it files a correction that supersedes it.
 */
export function FileDeclarationButton({
  orgId,
  period,
  periodLabel,
  latestFilingId,
  hasDrift,
  zeroReturn,
}: {
  orgId: string;
  period: string;
  periodLabel: string;
  latestFilingId: string | null;
  hasDrift: boolean;
  zeroReturn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('');
  // One key per opening of the dialog: a double click or a retry replays, it never files twice.
  const key = useRef(newIdempotencyKey());
  const correction = latestFilingId !== null;
  const file = useMutation({
    mutationFn: () =>
      fileDeclaration(
        orgId,
        period,
        { rsReference: reference.trim() || null, supersedesId: latestFilingId },
        key.current,
      ),
    onSuccess: (filing) => {
      setOpen(false);
      toast({
        title: correction ? `Correction filed (version ${filing.version})` : 'Return filed',
        description: `${periodLabel}: figures saved as filed.`,
        tone: 'positive',
      });
      router.refresh();
    },
  });

  return (
    <>
      <Button
        variant={correction && !hasDrift ? 'secondary' : 'primary'}
        className="print:hidden"
        onPress={() => {
          file.reset();
          key.current = newIdempotencyKey();
          setReference('');
          setOpen(true);
        }}
      >
        <FileCheck2 aria-hidden />
        {correction ? 'File correction' : zeroReturn ? 'Mark zero return filed' : 'Mark as filed'}
      </Button>
      <Dialog
        title={
          correction ? `File a correction for ${periodLabel}?` : `Mark ${periodLabel} as filed?`
        }
        description={
          correction
            ? 'Saves today’s figures as a new filing that supersedes the previous one. Earlier filings stay as they were.'
            : 'Saves today’s figures as filed. Nothing is sent to rs.ge: file the return there first, then record it here.'
        }
        isOpen={open}
        onOpenChange={setOpen}
        size="sm"
      >
        <TextField
          label="rs.ge reference number"
          description="Optional. The number rs.ge shows for the submitted return."
          value={reference}
          onChange={setReference}
          maxLength={64}
        />
        {file.isError ? <Notice tone="error">{errorMessage(file.error)}</Notice> : null}
        <DialogFooter>
          <Button
            variant="secondary"
            isDisabled={file.isPending}
            onPress={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            isPending={file.isPending}
            onPress={() => {
              file.mutate();
            }}
          >
            {correction ? 'File correction' : 'Mark as filed'}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
