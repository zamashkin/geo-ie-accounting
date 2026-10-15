import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stepper } from './Stepper';

const IMPORT_STEPS = [
  { id: 'upload', label: 'Upload', description: 'CSV or XLSX' },
  { id: 'parse', label: 'Parse', description: 'Read rows' },
  { id: 'review', label: 'Review', description: 'Categories, duplicates' },
  { id: 'commit', label: 'Commit', description: 'Post to ledger' },
];

const meta = {
  title: 'Navigation/Stepper',
  component: Stepper,
  args: { steps: IMPORT_STEPS, currentStepId: 'review', label: 'Import progress' },
} satisfies Meta<typeof Stepper>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ImportWizard: Story = {
  play: async ({ canvas }) => {
    const list = canvas.getByRole('list', { name: 'Import progress' });
    const items = canvas.getAllByRole('listitem');
    await expect(list).toBeVisible();
    await expect(items[2]).toHaveAttribute('aria-current', 'step');
    await expect(items[0]).toHaveTextContent('(completed)');
    await expect(items[3]).not.toHaveAttribute('aria-current');
  },
};

export const FirstStepDark: Story = {
  args: { currentStepId: 'upload' },
  globals: { theme: 'dark' },
};
