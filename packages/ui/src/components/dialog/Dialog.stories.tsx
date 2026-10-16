import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, waitFor } from 'storybook/test';
import { Button } from '../button/Button';
import { Dialog, DialogFooter, DialogTrigger } from './Dialog';

const onConfirm = fn();

const meta = {
  title: 'Overlays/Dialog',
  component: Dialog,
  args: { title: 'Reverse transaction?' },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmReversal: Story = {
  render: () => (
    <DialogTrigger>
      <Button variant="secondary">Reverse…</Button>
      <Dialog
        role="alertdialog"
        title="Reverse transaction?"
        description="A new transaction with every posting negated will be created. The original stays in the ledger."
      >
        {({ close }) => (
          <DialogFooter>
            <Button variant="secondary" onPress={close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                onConfirm();
                close();
              }}
            >
              Reverse
            </Button>
          </DialogFooter>
        )}
      </Dialog>
    </DialogTrigger>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Reverse…' });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('alertdialog', { name: 'Reverse transaction?' });
    // Focus moves into the dialog.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    await expect(onConfirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // Focus returns to the trigger.
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const EscapeCloses: Story = {
  render: () => (
    <DialogTrigger>
      <Button>Edit notes</Button>
      <Dialog
        title="Edit notes"
        description="Notes are the only field you can change after posting."
      >
        <p className="text-sm text-fg-muted">Form goes here.</p>
      </Dialog>
    </DialogTrigger>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Edit notes' }));
    await screen.findByRole('dialog', { name: 'Edit notes' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

export const OpenDark: Story = {
  globals: { theme: 'dark' },
  args: { isOpen: true, description: 'Dark theme, open by default.' },
  render: (args) => (
    <Dialog {...args}>
      <DialogFooter>
        <Button variant="secondary">Cancel</Button>
        <Button>Confirm</Button>
      </DialogFooter>
    </Dialog>
  ),
};
