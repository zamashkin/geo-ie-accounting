import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Badge, type BadgeTone } from './Badge';

const meta = {
  title: 'Display/Badge',
  component: Badge,
  args: { children: 'Filed', tone: 'positive', dot: true },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Filed')).toBeVisible();
  },
};

const ALL: [BadgeTone, string][] = [
  ['neutral', 'Draft'],
  ['accent', '1%'],
  ['positive', 'Committed'],
  ['negative', 'Failed'],
  ['warning', 'Filed figures differ'],
  ['info', 'Parsing'],
];

const Tones = () => (
  <div className="flex flex-wrap gap-2">
    {ALL.map(([tone, label]) => (
      <Badge key={tone} tone={tone} dot>
        {label}
      </Badge>
    ))}
  </div>
);

export const AllTones: Story = { render: Tones };
export const AllTonesDark: Story = { render: Tones, globals: { theme: 'dark' } };
