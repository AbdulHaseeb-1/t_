import { act, renderHook } from '@testing-library/react-native';
import { useSmoothText } from '../src/lib/useSmoothText';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const answer = 'Net sales rose **12%** in August, led by Karachi. '.repeat(12); // ~600 characters

describe('useSmoothText', () => {
  it('types while streaming, then shows the rest within a moment once the answer is complete', () => {
    const { result, rerender } = renderHook(({ text, pending }: { text: string; pending: boolean }) => useSmoothText(text, pending, !pending), {
      initialProps: { text: '', pending: true },
    });
    rerender({ text: answer, pending: true });
    act(() => jest.advanceTimersByTime(1000));
    // Typing pace: well short of the whole answer after a second.
    expect(result.current.text.length).toBeLessThan(answer.length / 2);
    expect(result.current.done).toBe(false);

    rerender({ text: answer, pending: false });
    act(() => jest.advanceTimersByTime(400));
    expect(result.current).toEqual({ text: answer, done: true });
  });

  it('shows answers loaded from history at once', () => {
    const { result } = renderHook(() => useSmoothText(answer, false));
    expect(result.current).toEqual({ text: answer, done: true });
  });
});
