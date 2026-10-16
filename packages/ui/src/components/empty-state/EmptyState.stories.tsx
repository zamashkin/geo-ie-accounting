import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileUp } from 'lucide-react';
import { expect } from 'storybook/test';
import { Button, ButtonLink } from '../button/Button';
import { LoadingRegion, Skeleton, SkeletonText } from '../skeleton/Skeleton';
import { EmptyState } from './EmptyState';

const meta = {
  title: 'Feedback/EmptyState',
  component: EmptyState,
  args: {
    icon: <FileUp />,
    title: 'No transactions yet',
    description:
      'Import a bank statement or add a transaction by hand. Income is converted at the NBG rate automatically.',
    actions: (
      <>
        <Button>Import statement</Button>
        <ButtonLink href="#new" variant="secondary">
          Add manually
        </ButtonLink>
      </>
    ),
  },
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'No transactions yet' }),
    ).toBeVisible();
  },
};

export const Dark: Story = { globals: { theme: 'dark' } };

export const Skeletons: StoryObj<typeof LoadingRegion> = {
  render: () => (
    <LoadingRegion label="Loading dashboard" className="grid max-w-2xl gap-4 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-8 w-2/3" />
          <SkeletonText lines={2} />
        </div>
      ))}
    </LoadingRegion>
  ),
  play: async ({ canvas }) => {
    const status = canvas.getByRole('status');
    await expect(status).toHaveAttribute('aria-busy', 'true');
    await expect(status).toHaveTextContent('Loading dashboard');
  },
};
