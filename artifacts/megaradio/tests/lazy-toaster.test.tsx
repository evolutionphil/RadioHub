import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { toast, useToast } from '../src/hooks/use-toast';
const runtime = vi.hoisted(() => ({ loaded: vi.fn() }));
vi.mock('@/components/ui/toaster', () => {
  runtime.loaded();
  return { Toaster: () => {
    const { toasts } = useToast();
    return <div data-testid="toast-runtime">{toasts.map(item => <span key={item.id} data-open={item.open}>{item.title}</span>)}</div>;
  } };
});
import { LazyToaster } from '../src/components/LazyToaster';

it('does not import the runtime until a message exists, retains that message and the closing runtime', async () => {
  render(<LazyToaster />);
  expect(runtime.loaded).not.toHaveBeenCalled();
  expect(screen.queryByTestId('toast-runtime')).toBeNull();
  let message!: ReturnType<typeof toast>;
  act(() => { message = toast({ title: 'Saved station' }); });
  expect(await screen.findByText('Saved station')).toHaveAttribute('data-open', 'true');
  expect(runtime.loaded).toHaveBeenCalledTimes(1);
  act(() => message.dismiss());
  expect(screen.getByText('Saved station')).toHaveAttribute('data-open', 'false');
  expect(screen.getByTestId('toast-runtime')).toBeInTheDocument();
});

it('renders a message that was queued before the host mounted', async () => {
  act(() => { toast({ title: 'Already queued' }); });
  render(<LazyToaster />);
  expect(await screen.findByText('Already queued')).toHaveAttribute('data-open', 'true');
});
