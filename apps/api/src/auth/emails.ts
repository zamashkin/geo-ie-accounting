import type { MailMessage } from './mailer';

// Plain transactional mail. Links carry single-use tokens: never log `url`.

/**
 * Better Auth's links point at the API (`/v1/auth/verify-email?token=…&callbackURL=…`), which
 * checks the token and redirects to `callbackURL`. A relative or missing callback would resolve
 * against the API origin, so it is made absolute on the web origin here. An absolute callback
 * has already been checked against the trusted origins and is left alone.
 */
export function withWebCallback(url: string, webOrigin: string, fallbackPath = '/'): string {
  const parsed = new URL(url);
  const callback = parsed.searchParams.get('callbackURL') ?? '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(callback)) return url;
  const path = callback.startsWith('/') && !callback.startsWith('//') ? callback : fallbackPath;
  parsed.searchParams.set('callbackURL', new URL(path, webOrigin).href);
  return parsed.href;
}

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
    'Confirm your email address for geo-ie-accounting.',
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
    'Someone asked to reset your geo-ie-accounting password. The link works once and expires in 1 hour.',
    'Choose a new password',
    url,
  );

export const changeEmailMail = (to: string, newEmail: string, url: string) =>
  message(
    to,
    'Confirm your new email for geo-ie-accounting',
    `Someone asked to change the email of your geo-ie-accounting account to ${newEmail}. ` +
      'Open the link to confirm; we then send a verification link to the new address.',
    'Confirm the change',
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
