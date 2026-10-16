import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Outgoing mail. SMTP in the running app (Mailpit locally); an in-memory outbox in tests. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
  close?(): void;
}

export function createSmtpMailer(opts: { url: string; from: string }): Mailer {
  const transport = nodemailer.createTransport(opts.url);
  return {
    async send(message) {
      await transport.sendMail({ from: opts.from, ...message });
    },
    close: () => {
      transport.close();
    },
  };
}

/** Used when no mailer is configured (OpenAPI generation, unit tests): refuses to send. */
export const unconfiguredMailer: Mailer = {
  send: () => Promise.reject(new Error('No mailer configured')),
};
