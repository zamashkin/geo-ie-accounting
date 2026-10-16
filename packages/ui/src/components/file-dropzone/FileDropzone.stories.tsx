import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { FileDropzone, type FileDropzoneProps } from './FileDropzone';

const onFiles = fn();

function Demo(props: Partial<FileDropzoneProps>) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <div className="max-w-lg">
      <FileDropzone
        label="Bank statement"
        accept={['.csv', '.xlsx']}
        maxSizeBytes={10 * 1024 * 1024}
        description="Export from TBC or Bank of Georgia internet banking."
        {...props}
        value={files}
        onChange={(next) => {
          onFiles(next);
          setFiles(next);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Forms/FileDropzone',
  component: FileDropzone,
  render: () => <Demo />,
  args: { label: 'Bank statement', value: [], onChange: fn() },
} satisfies Meta<typeof FileDropzone>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChooseFile: Story = {
  play: async ({ canvasElement, canvas, userEvent }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('file input missing');
    const file = new File(['date,amount\n2026-10-12,1000.00'], 'statement-oct.csv', {
      type: 'text/csv',
    });
    await userEvent.upload(input, file);
    await expect(onFiles).toHaveBeenLastCalledWith([file]);
    const list = canvas.getByRole('list', { name: 'Selected files' });
    await expect(list).toHaveTextContent('statement-oct.csv');
    await userEvent.click(canvas.getByRole('button', { name: 'Remove statement-oct.csv' }));
    await expect(canvas.queryByRole('list', { name: 'Selected files' })).not.toBeInTheDocument();
  },
};

export const RejectsOversizedFile: Story = {
  render: () => <Demo maxSizeBytes={1024} />,
  play: async ({ canvasElement, canvas, userEvent }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('file input missing');
    await userEvent.upload(
      input,
      new File([new Uint8Array(4096)], 'big.csv', { type: 'text/csv' }),
    );
    await expect(canvas.getByRole('alert')).toHaveTextContent('big.csv is larger than 1.0 KB');
    await expect(canvas.queryByRole('list', { name: 'Selected files' })).not.toBeInTheDocument();
  },
};

export const WithServerError: Story = {
  render: () => <Demo errorMessage="Upload failed: the server is not reachable. Try again." />,
};
