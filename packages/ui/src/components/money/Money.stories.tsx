import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { MoneyInput } from './MoneyInput';
import { MoneyText } from './MoneyText';

const meta = {
  title: 'Money/MoneyInput',
  component: MoneyInput,
  args: { label: 'Amount', currency: 'USD', onChange: fn() },
  decorators: [(Story) => <div className="max-w-xs">{Story()}</div>],
} satisfies Meta<typeof MoneyInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TypesIntoMinorUnits: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole('textbox', { name: /amount/i });
    await userEvent.type(input, '1250.5');
    // Minor units as a string: no float ever involved.
    await expect(args.onChange).toHaveBeenLastCalledWith('125050');
    await userEvent.tab();
    await expect(input).toHaveValue('1,250.50');
  },
};

export const BeyondFloatPrecision: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole('textbox', { name: /amount/i });
    await userEvent.type(input, '90071992547409.93');
    await expect(args.onChange).toHaveBeenLastCalledWith('9007199254740993');
  },
};

export const RejectsTooManyDecimals: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole('textbox', { name: /amount/i });
    await userEvent.type(input, '10.999');
    await expect(args.onChange).toHaveBeenLastCalledWith('1099');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(await canvas.findByText('USD allows 2 decimal places')).toBeVisible();
  },
};

function Controlled() {
  const [value, setValue] = useState<string | null>('500000');
  return (
    <div className="flex flex-col gap-3">
      <MoneyInput label="Invoice total" currency="GEL" value={value} onChange={setValue} />
      <p className="text-sm text-fg-muted">
        Value: <code data-testid="value">{value ?? 'null'}</code>
      </p>
      <button
        type="button"
        className="self-start text-sm underline"
        onClick={() => {
          setValue('199');
        }}
      >
        Set to 1.99
      </button>
    </div>
  );
}

export const ControlledValue: Story = {
  render: () => <Controlled />,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: /invoice total/i });
    await expect(input).toHaveValue('5,000.00');
    await userEvent.click(canvas.getByRole('button', { name: 'Set to 1.99' }));
    await expect(input).toHaveValue('1.99');
    await userEvent.clear(input);
    await expect(canvas.getByTestId('value')).toHaveTextContent('null');
  },
};

export const MoneyTextExamples: StoryObj<typeof MoneyText> = {
  render: () => (
    <table className="text-sm">
      <tbody>
        {(
          [
            ['Income', '125000', 'USD', 'signed'],
            ['Bank fee', '-1250', 'GEL', 'signed'],
            ['Tax due', '69085', 'GEL', 'neutral'],
            ['Huge', '9223372036854775807', 'EUR', 'neutral'],
          ] as const
        ).map(([label, amount, currency, tone]) => (
          <tr key={label}>
            <th scope="row" className="pe-6 text-start font-normal text-fg-muted">
              {label}
            </th>
            <td className="text-end">
              <MoneyText amountMinor={amount} currency={currency} tone={tone} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/1,250\.00/)).toBeVisible();
    await expect(canvas.getByText(/92,233,720,368,547,758\.07/)).toBeVisible();
  },
};

export const MoneyTextDark: StoryObj<typeof MoneyText> = {
  ...MoneyTextExamples,
  globals: { theme: 'dark' },
};
