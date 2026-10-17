// Renders an invoice to PDF bytes on request (ADR 0015): no worker job, nothing stored.
import type { InvoiceView } from '@geo-ie-accounting/contracts';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { createElement, type ReactElement } from 'react';
import { registerInvoiceFonts } from './fonts';
import { InvoiceDocument } from './InvoiceDocument';

export async function renderInvoicePdf(invoice: InvoiceView): Promise<Buffer> {
  registerInvoiceFonts();
  // InvoiceDocument renders a <Document>; the typings want the Document element itself.
  const element = createElement(InvoiceDocument, {
    invoice,
  }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
