import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen } from 'storybook/test';
import { DatePicker } from './DatePicker';

const meta = {
  title: 'Forms/DatePicker',
  component: DatePicker,
  args: {
    label: 'Received on',
    description: 'The NBG rate valid on this date is used.',
    defaultValue: '2026-10-12',
    onChange: fn(),
  },
  decorators: [(Story) => <div className="max-w-xs">{Story()}</div>],
} satisfies Meta<typeof DatePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PickFromCalendar: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: /calendar/i }));
    const dialog = await screen.findByRole('dialog');
    await expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /15 October 2026/ }));
    await expect(args.onChange).toHaveBeenCalledWith('2026-10-15');
  },
};

export const TypeWithKeyboard: Story = {
  args: { defaultValue: null },
  play: async ({ canvas, userEvent, args }) => {
    const day = canvas.getAllByRole('spinbutton')[0];
    if (!day) throw new Error('no date segments');
    await userEvent.click(day);
    // en-GB order: day, month, year.
    await userEvent.keyboard('01022026');
    await expect(args.onChange).toHaveBeenLastCalledWith('2026-02-01');
  },
};

export const WithLimits: Story = {
  args: {
    minValue: '2026-03-01',
    maxValue: '2026-10-16',
    description: 'Small-business status started on 1 March.',
  },
};

export const Invalid: Story = {
  args: { isInvalid: true, errorMessage: 'The date is before your status started' },
};
