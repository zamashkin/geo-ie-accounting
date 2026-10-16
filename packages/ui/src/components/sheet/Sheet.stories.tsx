import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, waitFor } from 'storybook/test';
import { Button } from '../button/Button';
import { DialogTrigger } from '../dialog/Dialog';
import { Sheet } from './Sheet';

const meta = {
  title: 'Overlays/Sheet',
  component: Sheet,
  args: { title: 'Transaction details' },
} satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RightPanel: Story = {
  render: (args) => (
    <DialogTrigger>
      <Button variant="secondary">Show details</Button>
      <Sheet {...args} description="12 Oct 2026, imported from Bank of Georgia">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-fg-muted">Amount</dt>
          <dd>USD 1,000.00</dd>
          <dt className="text-fg-muted">NBG rate</dt>
          <dd>2.7123 (valid from 11 Oct)</dd>
        </dl>
      </Sheet>
    </DialogTrigger>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Show details' }));
    await screen.findByRole('dialog', { name: 'Transaction details' });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

export const LeftNavigation: Story = {
  args: { side: 'left', title: 'Navigation', hideTitle: true, isOpen: true },
  render: (args) => (
    <Sheet {...args}>
      <p className="text-sm text-fg-muted">Mobile navigation renders here (see App/AppShell).</p>
    </Sheet>
  ),
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
  },
};
