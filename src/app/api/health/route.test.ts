import { describe, it, expect } from 'vitest'
import { GET } from './route'

describe('GET /api/health', () => {
  it('returns 200 status', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns JSON with status: ok or degraded', async () => {
    const res = await GET()
    const json = await res.json()
    // В dev без всех env vars может быть "degraded" — это нормально
    expect(['ok', 'degraded']).toContain(json.status)
  })

  it('includes service name', async () => {
    const res = await GET()
    const json = await res.json()
    expect(json.service).toBe('conditera')
  })

  it('includes version string', async () => {
    const res = await GET()
    const json = await res.json()
    expect(typeof json.version).toBe('string')
    expect(json.version.length).toBeGreaterThan(0)
  })

  it('includes ISO timestamp', async () => {
    const res = await GET()
    const json = await res.json()
    expect(json.timestamp).toBeDefined()
    // Должна быть валидной ISO-датой
    const d = new Date(json.timestamp)
    expect(d.getTime()).not.toBeNaN()
  })

  it('includes uptime number', async () => {
    const res = await GET()
    const json = await res.json()
    expect(typeof json.uptime).toBe('number')
    expect(json.uptime).toBeGreaterThanOrEqual(0)
  })

  it('includes features object with v2.0 capabilities', async () => {
    const res = await GET()
    const json = await res.json()
    expect(json.features).toBeDefined()
    expect(json.features.roles_v2).toBe(true)
    expect(json.features.recipe_marketplace).toBe(true)
    expect(json.features.loyalty_partners).toBe(true)
    expect(json.features.ai_assistant).toBe(true)
    expect(json.features.rbac).toBe(true)
    expect(json.features.csrf_protection).toBe(true)
  })

  it('includes dependencies array with configuration status', async () => {
    const res = await GET()
    const json = await res.json()
    expect(Array.isArray(json.dependencies)).toBe(true)
    // Хотя бы supabase должна быть в списке
    const supabaseDep = json.dependencies.find((d: any) => d.name === 'supabase')
    expect(supabaseDep).toBeDefined()
    expect(typeof supabaseDep.required).toBe('boolean')
    expect(typeof supabaseDep.configured).toBe('boolean')
  })

  it('includes environment field', async () => {
    const res = await GET()
    const json = await res.json()
    expect(typeof json.environment).toBe('string')
  })
})
