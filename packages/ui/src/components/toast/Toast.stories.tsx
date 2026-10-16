import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, waitFor } from 'storybook/test';
import { Button } from '../button/Button';
import { toast, Toaster } from './Toast';

// The preview decorator (UiProvider) already renders the Toaster.
const meta = {
  title: 'Feedback/Toast',
  component: Toaster,
} satisfies Meta<typeof Toaster>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onPress={() =>
          toast({
            title: 'Import committed',
            description: '214 transactions added.',
            tone: 'positive',
          })
        }
      >
        Success
      </Button>
      <Button
        variant="secondary"
        onPress={() =>
          toast({
            title: 'Upload failed',
            description: 'The file is not a BoG statement.',
            tone: 'negative',
          })
        }
      >
        Error
      </Button>
      <Button
        variant="secondary"
        onPress={() =>
          toast({
            title: 'Rate missing for 3 Oct',
            description: 'Backfilling from NBG…',
            tone: 'warning',
          })
        }
      >
        Warning
      </Button>
      <Button variant="secondary" onPress={() => toast({ title: 'Rates updated' })}>
        Neutral
      </Button>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Success' }));
    const region = await screen.findByRole('region', { name: /notifications/i });
    await waitFor(() => expect(region).toHaveTextContent('Import committed'));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Import committed')).not.toBeInTheDocument());
  },
};
