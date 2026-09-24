import { describe, it, expect } from 'vitest'
import { cn, formatDistanceToNow } from './utils'

describe('cn (className merger)', () => {
  it('merges multiple class names', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz')
  })

  it('handles no arguments', () => {
    expect(cn()).toBe('')
  })

  it('handles single argument', () => {
    expect(cn('single')).toBe('single')
  })

  it('handles conditional classes (undefined/false)', () => {
    expect(cn('base', false, undefined, null, 'visible')).toBe('base visible')
  })

  it('handles object syntax (clsx feature)', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })

  it('handles array syntax', () => {
    expect(cn('base', ['arr1', 'arr2'])).toBe('base arr1 arr2')
  })

  it('deduplicates tailwind classes (twMerge)', () => {
    // p-2 потом p-4 → должно остаться только p-4
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('deduplicates conflicting text colors', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('keeps non-conflicting classes', () => {
    expect(cn('p-4', 'bg-red-500', 'rounded')).toBe('p-4 bg-red-500 rounded')
  })

  it('handles empty strings', () => {
    expect(cn('', 'foo', '')).toBe('foo')
  })

  it('handles mixed types', () => {
    expect(cn('base', ['arr'], { obj: true }, false, undefined)).toBe('base arr obj')
  })
})

describe('formatDistanceToNow (Russian pluralization)', () => {
  it('returns "только что" for recent date', () => {
    const now = new Date()
    expect(formatDistanceToNow(now)).toBe('только что')
  })

  it('returns "только что" for date a few seconds ago', () => {
    const d = new Date(Date.now() - 5 * 1000)
    expect(formatDistanceToNow(d)).toBe('только что')
  })

  it('returns "1 минуту назад" for 1 minute ago', () => {
    const d = new Date(Date.now() - 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('1 минуту назад')
  })

  it('returns "2 минуты назад" for 2 minutes ago', () => {
    const d = new Date(Date.now() - 2 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('2 минуты назад')
  })

  it('returns "3 минуты назад" for 3 minutes ago', () => {
    const d = new Date(Date.now() - 3 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('3 минуты назад')
  })

  it('returns "4 минуты назад" for 4 minutes ago', () => {
    const d = new Date(Date.now() - 4 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('4 минуты назад')
  })

  it('returns "5 минут назад" for 5 minutes ago', () => {
    const d = new Date(Date.now() - 5 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('5 минут назад')
  })

  it('returns "11 минут назад" for 11 minutes ago', () => {
    const d = new Date(Date.now() - 11 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('11 минут назад')
  })

  it('returns "21 минуту назад" for 21 minutes ago', () => {
    const d = new Date(Date.now() - 21 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('21 минуту назад')
  })

  it('returns "22 минуты назад" for 22 minutes ago', () => {
    const d = new Date(Date.now() - 22 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('22 минуты назад')
  })

  it('returns "1 час назад" for 1 hour ago', () => {
    const d = new Date(Date.now() - 60 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('1 час назад')
  })

  it('returns "2 часа назад" for 2 hours ago', () => {
    const d = new Date(Date.now() - 2 * 60 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('2 часа назад')
  })

  it('returns "5 часов назад" for 5 hours ago', () => {
    const d = new Date(Date.now() - 5 * 60 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('5 часов назад')
  })

  it('returns "11 часов назад" for 11 hours ago', () => {
    const d = new Date(Date.now() - 11 * 60 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('11 часов назад')
  })

  it('returns "21 час назад" for 21 hours ago', () => {
    const d = new Date(Date.now() - 21 * 60 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('21 час назад')
  })

  it('returns "1 день назад" for 1 day ago', () => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('1 день назад')
  })

  it('returns "2 дня назад" for 2 days ago', () => {
    const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('2 дня назад')
  })

  it('returns "5 дней назад" for 5 days ago', () => {
    const d = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    expect(formatDistanceToNow(d)).toBe('5 дней назад')
  })

  it('returns formatted date for > 7 days', () => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const result = formatDistanceToNow(d)
    // Должна быть дата в формате dd.mm.yyyy или похожем
    expect(result).not.toContain('дней назад')
    expect(result).toMatch(/\d{1,2}\.\d{1,2}\.\d{4}/)
  })
})
