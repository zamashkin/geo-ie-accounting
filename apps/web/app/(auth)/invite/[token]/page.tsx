import type { Metadata } from 'next';
import { InviteCard } from './InviteCard';

export const metadata: Metadata = { title: 'Invitation' };

export default async function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  return <InviteCard token={token} />;
}
