import type { Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import { UiProvider } from '../src/components/provider/UiProvider';
import './storybook.css';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    // Every story is an accessibility test: axe violations fail `pnpm test:storybook`.
    a11y: {
      test: 'error',
      options: {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
        // Stories render one component without page landmarks; the app shell has them.
        rules: { region: { enabled: false } },
      },
    },
  },
  decorators: [
    (Story, ctx) => {
      const theme = ctx.globals['theme'] === 'dark' ? 'dark' : 'light';
      useEffect(() => {
        document.documentElement.dataset['theme'] = theme;
      }, [theme]);
      // Set synchronously too, so the first paint (and the axe run) uses the right theme.
      document.documentElement.dataset['theme'] = theme;
      return (
        <UiProvider>
          <div className="min-h-full bg-canvas p-1 text-fg">
            <Story />
          </div>
        </UiProvider>
      );
    },
  ],
  tags: ['autodocs'],
};

export default preview;
