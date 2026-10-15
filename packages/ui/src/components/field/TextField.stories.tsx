import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { TextField } from './Field';

const meta = {
  title: 'Forms/TextField',
  component: TextField,
  args: {
    label: 'Email',
    type: 'email',
    placeholder: 'you@example.ge',
    description: 'We send the sign-in link here.',
    onChange: fn(),
  },
  decorators: [(Story) => <div className="max-w-sm">{Story()}</div>],
} satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole('textbox', { name: 'Email' });
    await expect(input).toHaveAccessibleDescription('We send the sign-in link here.');
    await userEvent.type(input, 'nino@example.ge');
    await expect(args.onChange).toHaveBeenLastCalledWith('nino@example.ge');
  },
};

export const Invalid: Story = {
  args: { isInvalid: true, errorMessage: 'Enter a valid email address', defaultValue: 'nino@' },
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Email' });
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(/enter a valid email address/i);
  },
};

export const RequiredWithNativeValidation: Story = {
  args: { isRequired: true, description: undefined, errorMessage: 'Email is required' },
  render: (args) => (
    <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
      <TextField {...args} />
      <button
        type="submit"
        className="self-start rounded-md border border-line px-3 py-1.5 text-sm"
      >
        Submit
      </button>
    </form>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));
    await expect(await canvas.findByText('Email is required')).toBeVisible();
  },
};

export const Disabled: Story = { args: { isDisabled: true, defaultValue: 'locked@example.ge' } };
