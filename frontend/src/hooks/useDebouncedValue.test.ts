import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 200))
    expect(result.current).toBe('a')
  })

  it('updates only after the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'b' })
    expect(result.current).toBe('a') // not yet
    act(() => void vi.advanceTimersByTime(199))
    expect(result.current).toBe('a')
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe('b')
  })

  it('resets the timer on rapid changes (only the last value lands)', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'ab' })
    act(() => void vi.advanceTimersByTime(150))
    rerender({ value: 'abc' })
    act(() => void vi.advanceTimersByTime(150))
    expect(result.current).toBe('a') // still debouncing
    act(() => void vi.advanceTimersByTime(50))
    expect(result.current).toBe('abc')
  })
})
