import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Tab, TabList, TabPanel, Tabs } from './Tabs';

const meta = {
  title: 'Navigation/Tabs',
  component: Tabs,
} satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignInMethods: Story = {
  render: () => (
    <Tabs className="max-w-md">
      <TabList aria-label="Sign-in method">
        <Tab id="password">Password</Tab>
        <Tab id="link">Email link</Tab>
        <Tab id="sso" isDisabled>
          SSO
        </Tab>
      </TabList>
      <TabPanel id="password">
        <p className="text-sm text-fg-muted">Email and password form.</p>
      </TabPanel>
      <TabPanel id="link">
        <p className="text-sm text-fg-muted">We email you a one-time sign-in link.</p>
      </TabPanel>
      <TabPanel id="sso">SSO</TabPanel>
    </Tabs>
  ),
  play: async ({ canvas, userEvent }) => {
    const password = canvas.getByRole('tab', { name: 'Password' });
    await expect(password).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(password);
    await userEvent.keyboard('{ArrowRight}');
    const link = canvas.getByRole('tab', { name: 'Email link' });
    await expect(link).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('one-time sign-in link');
    // Disabled tabs are skipped by arrow keys.
    await userEvent.keyboard('{ArrowRight}');
    await expect(password).toHaveAttribute('aria-selected', 'true');
  },
};
