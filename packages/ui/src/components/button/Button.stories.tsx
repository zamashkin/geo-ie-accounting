import type { Meta, StoryObj } from '@storybook/react-vite';
import { Download, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { Button, ButtonLink } from './Button';

const meta = {
  title: 'Actions/Button',
  component: Button,
  args: { children: 'Save', onPress: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'icon', 'icon-sm'] },
  },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const button = canvas.getByRole('button', { name: 'Save' });
    await userEvent.click(button);
    await expect(args.onPress).toHaveBeenCalledOnce();
    // Keyboard activation works the same way.
    button.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onPress).toHaveBeenCalledTimes(2);
  },
};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Plus aria-hidden /> New transaction
      </Button>
      <Button variant="secondary">
        <Download aria-hidden /> Export CSV
      </Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">
        <Trash2 aria-hidden /> Delete rule
      </Button>
      <Button size="sm" variant="secondary">
        Small
      </Button>
      <Button size="icon" variant="ghost" aria-label="Add">
        <Plus aria-hidden />
      </Button>
      <Button isDisabled>Disabled</Button>
      <ButtonLink href="#somewhere" variant="secondary">
        Link styled as button
      </ButtonLink>
    </div>
  ),
};

export const DarkTheme: Story = {
  ...Variants,
  globals: { theme: 'dark' },
};

function PendingDemo() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      isPending={pending}
      onPress={() => {
        setPending(true);
        setTimeout(() => setPending(false), 300);
      }}
    >
      Commit import
    </Button>
  );
}

export const Pending: Story = {
  render: () => <PendingDemo />,
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: /commit import/i });
    await userEvent.click(button);
    // React Aria keeps the button focusable but reports it as busy while pending.
    await expect(button).toHaveAttribute('data-pending', 'true');
  },
};
