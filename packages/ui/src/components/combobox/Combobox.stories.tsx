import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, waitFor } from 'storybook/test';
import type { SelectOption } from '../select/Select';
import { Combobox } from './Combobox';

const ACCOUNTS: SelectOption[] = [
  { id: 'income-services', label: 'Income: Services', description: 'SBS, 1% regime' },
  { id: 'income-rental', label: 'Income: Rental', description: 'Non-SBS' },
  { id: 'income-interest', label: 'Income: Interest', description: 'Non-SBS' },
  { id: 'expense-software', label: 'Expense: Software' },
  { id: 'expense-bank-fees', label: 'Expense: Bank fees' },
  { id: 'owner-equity', label: 'Owner equity' },
  { id: 'fx-clearing', label: 'FX clearing', isDisabled: true },
];

const meta = {
  title: 'Forms/Combobox',
  component: Combobox<string>,
  args: {
    label: 'Category',
    options: ACCOUNTS,
    placeholder: 'Search accounts',
    onChange: fn(),
  },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof Combobox<string>>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FilterAndPick: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole('combobox', { name: 'Category' });
    await userEvent.type(input, 'rent');
    const options = await screen.findAllByRole('option');
    await expect(options).toHaveLength(1);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onChange).toHaveBeenCalledWith('income-rental');
    await expect(input).toHaveValue('Income: Rental');
  },
};

export const NoMatches: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox', { name: 'Category' }), 'zzz');
    await waitFor(() => expect(screen.getByText('No matches')).toBeVisible());
  },
};

export const Preselected: Story = { args: { value: 'income-services' } };
