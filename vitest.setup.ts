import '@testing-library/jest-dom/vitest'
import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Установить development env для тестов (чтобы supabase browser не падал на production check)
;(process.env as Record<string, string>).NODE_ENV = 'development'
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:8000'
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
}

// Очистка RTL после каждого теста
afterEach(() => {
  cleanup()
})

// Mock next/navigation (router)
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

// Mock next/headers (server-only)
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: () => null,
    getAll: () => [],
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: () => new Headers(),
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: any) => {
    return React.createElement('img', { src, alt, ...props })
  },
}))

// React для mock next/image
import React from 'react'

// Mock matchMedia (не реализован в jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
})

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])
  root = null
  rootMargin = ''
  thresholds = []
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
})
Object.defineProperty(global, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
})

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
})

// Mock scrollTo
window.scrollTo = vi.fn() as any
// scrollIntoView — это метод Element, не window
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn() as any
}

// Подавляем шум консоли в тестах (можно включить обратно при дебаге)
const originalError = console.error
console.error = (...args: any[]) => {
  // Игнорируем известные предупреждения React Testing Library об act()
  if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return
  originalError.call(console, ...args)
}
