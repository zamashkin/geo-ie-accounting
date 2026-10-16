// Multipart bodies for statement uploads in API integration tests.
import { randomUUID } from 'node:crypto';

/** A multipart/form-data body with one `file` part and optional text fields. */
export function multipart(file: Buffer, fileName: string, fields: Record<string, string> = {}) {
  const boundary = `----ie-ledger-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
