import type { MailMessage } from './mailer';

// Plain transactional mail. Links carry single-use tokens: never log `url`.

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function message(to: string, subject: string, intro: string, action: string, url: string) {
  return {
    to,
    subject,
    text: `${intro}\n\n${action}: ${url}\n\nIf you did not ask for this, ignore this email.`,
    html:
      `<p>${escapeHtml(intro)}</p>` +
      `<p><a href="${escapeHtml(url)}">${escapeHtml(action)}</a></p>` +
      '<p>If you did not ask for this, ignore this email.</p>',
  } satisfies MailMessage;
}

export const verifyEmailMail = (to: string, url: string) =>
  message(
    to,
    'Confirm your email for geo-ie-accounting',
    'Confirm your email address.',
    'Confirm email',
    url,
  );

export const magicLinkMail = (to: string, url: string) =>
  message(
    to,
    'Your geo-ie-accounting sign-in link',
    'Use this link to sign in. It works once and expires in 10 minutes.',
    'Sign in',
    url,
  );

export const resetPasswordMail = (to: string, url: string) =>
  message(
    to,
    'Reset your geo-ie-accounting password',
    'Someone asked to reset your password.',
    'Reset password',
    url,
  );

export const invitationMail = (to: string, orgName: string, role: string, url: string) =>
  message(
    to,
    `You are invited to ${orgName} on geo-ie-accounting`,
    `You have been invited to ${orgName} as ${role}. The invitation expires in 7 days.`,
    'Open invitation',
    url,
  );
