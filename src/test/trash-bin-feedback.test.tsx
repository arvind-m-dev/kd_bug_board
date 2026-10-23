import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: mocks }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/components/bugflow/action-feedback', () => ({ actionError: () => 'Retry' }));
import { moveToTrashToast } from '@/components/bugflow/trash-bin';
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('matchMedia', () => ({ matches: false })); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function show(onUndo?: () => Promise<unknown>) {
  moveToTrashToast({ title: 'Moved to Trash', label: 'Example', onUndo });
  const factory = mocks.custom.mock.calls[0]![0] as (id: number) => ReactNode;
  return render(factory(42));
}
it('holds the complete notification for five seconds, then lowers it and dismisses', () => {
  const { container } = show();
  act(() => vi.advanceTimersByTime(4999));
  expect(container.querySelector('.bf-bin-toast')).not.toHaveAttribute('data-lowered');
  act(() => vi.advanceTimersByTime(1));
  expect(container.querySelector('.bf-bin-toast')).toHaveAttribute('data-lowered', 'true');
  expect(mocks.dismiss).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(600));
  expect(mocks.dismiss).toHaveBeenCalledWith(42);
});
it('keeps Undo available during a pending restore and restarts the hold after failure', async () => {
  let reject!: (reason: Error) => void;
  show(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  act(() => vi.advanceTimersByTime(10000));
  expect(mocks.dismiss).not.toHaveBeenCalled();
  await act(async () => { reject(new Error('Unavailable')); });
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  act(() => vi.advanceTimersByTime(4999));
  expect(mocks.dismiss).not.toHaveBeenCalled();
});
