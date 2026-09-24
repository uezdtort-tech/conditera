import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  formatDate,
  ORDER_STATUS_LABELS,
  COURIER_TRANSPORT,
  TARIFFS,
  LOYALTY,
  getLoyaltyLevel,
  calculateBonusPoints,
  calculateCommission,
  calculateDistance,
} from './finance'

describe('formatCurrency', () => {
  it('formats integer RUB correctly', () => {
    const result = formatCurrency(1500)
    // ru-RU использует неразрывный пробел как разделитель тысяч
    expect(result).toMatch(/1\s?500/)
    expect(result).toContain('₽')
  })

  it('formats large numbers', () => {
    const result = formatCurrency(1234567)
    expect(result).toMatch(/1\s?234\s?567/)
    expect(result).toContain('₽')
  })

  it('rounds to integer (maximumFractionDigits=0)', () => {
    const result = formatCurrency(1234.56)
    // Не должно быть дробной части
    expect(result).not.toMatch(/\d,\d/)
  })

  it('handles zero', () => {
    const result = formatCurrency(0)
    expect(result).toContain('0')
    expect(result).toContain('₽')
  })

  it('handles negative amounts', () => {
    const result = formatCurrency(-500)
    expect(result).toContain('500')
    expect(result).toContain('₽')
  })
})

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2026-08-08T12:00:00Z')
    expect(result).toContain('2026')
    // Должен содержать месяц
    expect(result.length).toBeGreaterThan(5)
  })

  it('formats Date object', () => {
    const d = new Date('2026-01-15T10:00:00Z')
    const result = formatDate(d)
    expect(result).toContain('2026')
  })
})

describe('ORDER_STATUS_LABELS', () => {
  it('contains all expected statuses', () => {
    const expectedStatuses = [
      'PENDING',
      'CONFIRMED',
      'IN_PROGRESS',
      'READY',
      'DELIVERING',
      'COMPLETED',
      'CANCELLED',
      'DISPUTE',
    ]
    for (const status of expectedStatuses) {
      expect(ORDER_STATUS_LABELS[status]).toBeDefined()
      expect(ORDER_STATUS_LABELS[status].label).toBeTruthy()
      expect(ORDER_STATUS_LABELS[status].color).toBeTruthy()
    }
  })

  it('has label and color for each status', () => {
    for (const key of Object.keys(ORDER_STATUS_LABELS)) {
      const entry = ORDER_STATUS_LABELS[key]
      expect(typeof entry.label).toBe('string')
      expect(typeof entry.color).toBe('string')
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })
})

describe('COURIER_TRANSPORT', () => {
  it('has at least one transport type', () => {
    expect(Object.keys(COURIER_TRANSPORT).length).toBeGreaterThan(0)
  })

  it('has label, icon, maxWeight, speed for each transport', () => {
    for (const key of Object.keys(COURIER_TRANSPORT)) {
      const t = COURIER_TRANSPORT[key]
      expect(t.label).toBeTruthy()
      expect(t.icon).toBeTruthy()
      expect(typeof t.maxWeight).toBe('number')
      expect(t.speed).toBeTruthy()
    }
  })
})

describe('TARIFFS', () => {
  it('is defined', () => {
    expect(TARIFFS).toBeDefined()
    expect(typeof TARIFFS).toBe('object')
  })
})

describe('LOYALTY', () => {
  it('is defined with at least one level', () => {
    expect(LOYALTY).toBeDefined()
    expect(Object.keys(LOYALTY).length).toBeGreaterThan(0)
  })
})

describe('getLoyaltyLevel', () => {
  it('returns a level for zero spend', () => {
    const level = getLoyaltyLevel(0)
    expect(level).toBeTruthy()
  })

  it('returns a level for high spend', () => {
    const level = getLoyaltyLevel(100000)
    expect(level).toBeTruthy()
  })
})

describe('calculateBonusPoints', () => {
  it('returns a number for valid level', () => {
    const result = calculateBonusPoints(1000, 'BRONZE')
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('uses BRONZE level by default', () => {
    const result = calculateBonusPoints(1000)
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
  })

  it('returns 0 for amount less than 100', () => {
    const result = calculateBonusPoints(50, 'BRONZE')
    expect(result).toBe(0)
  })
})

describe('calculateCommission', () => {
  it('returns commission breakdown object', () => {
    const result = calculateCommission(1000, 'START')
    expect(result).toBeDefined()
    expect(typeof result.platformFee).toBe('number')
    expect(typeof result.yookassaFee).toBe('number')
    expect(typeof result.totalFee).toBe('number')
    expect(typeof result.confectionerPayout).toBe('number')
  })

  it('confectioner payout = amount - totalFee', () => {
    const result = calculateCommission(1000, 'START')
    expect(result.confectionerPayout).toBe(1000 - result.totalFee)
  })

  it('platformFee + yookassaFee = totalFee', () => {
    const result = calculateCommission(1000, 'START')
    expect(result.totalFee).toBe(result.platformFee + result.yookassaFee)
  })

  it('returns non-negative values for positive amount', () => {
    const result = calculateCommission(1000, 'START')
    expect(result.platformFee).toBeGreaterThanOrEqual(0)
    expect(result.yookassaFee).toBeGreaterThanOrEqual(0)
    expect(result.confectionerPayout).toBeGreaterThanOrEqual(0)
  })
})

describe('calculateDistance', () => {
  it('returns 0 for same point', () => {
    const result = calculateDistance(55.7558, 37.6173, 55.7558, 37.6173)
    // Допускаем небольшую погрешность вычислений float
    expect(result).toBeLessThan(1)
  })

  it('returns positive distance for different points', () => {
    // Москва — Санкт-Петербург ~ 630 км
    const result = calculateDistance(55.7558, 37.6173, 59.9343, 30.3351)
    expect(result).toBeGreaterThan(500)
    expect(result).toBeLessThan(800)
  })
})
