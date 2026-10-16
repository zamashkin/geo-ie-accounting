import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen } from 'storybook/test';
import { Select, type SelectOption } from './Select';

const PAYMENT_METHODS: SelectOption[] = [
  { id: 'bank', label: 'Bank account', description: 'Return line 20' },
  { id: 'pos', label: 'POS terminal', description: 'Return line 19' },
  { id: 'cash_register', label: 'Cash register', description: 'Return line 18' },
  { id: 'other', label: 'Other', description: 'Return line 21' },
];

const meta = {
  title: 'Forms/Select',
  component: Select<string>,
  args: { label: 'Payment method', options: PAYMENT_METHODS, onChange: fn() },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof Select<string>>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const trigger = canvas.getByRole('button', { name: /payment method/i });
    await userEvent.click(trigger);
    await screen.findByRole('listbox');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('option', { name: /POS terminal/ }));
    await expect(args.onChange).toHaveBeenCalledWith('pos');
    await expect(trigger).toHaveTextContent('POS terminal');
  },
};

export const KeyboardOnly: Story = {
  play: async ({ canvas, userEvent, args }) => {
    canvas.getByRole('button', { name: /payment method/i }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('pos');
  },
};

export const WithValue: Story = { args: { value: 'bank' } };

export const Invalid: Story = {
  args: { isInvalid: true, errorMessage: 'Choose how the money arrived' },
};
