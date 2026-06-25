import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createMSWInterceptor } from '../../src/interceptors/msw.js'
import type { SpecifyData } from '../../src/types.js'

describe('createMSWInterceptor', () => {
  it('returns an object with start, stop and reset functions', () => {
    const interceptor = createMSWInterceptor(async () => null)

    expect(typeof interceptor.start).toBe('function')
    expect(typeof interceptor.stop).toBe('function')
    expect(typeof interceptor.reset).toBe('function')
  })

  describe('request interception', () => {
    const data: SpecifyData = { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } }
    const interceptor = createMSWInterceptor(async () => data)

    beforeAll(() => interceptor.start())
    afterAll(() => interceptor.stop())

    it('wraps resolved data in a data envelope', async () => {
      const response = await fetch('http://localhost:3000/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query Me { me { id name email } }' }),
      })

      const json = await response.json()
      expect(json).toEqual({ data })
    })

  })
})
