import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createMSWInterceptor } from '../../src/interceptors/msw.js'
import type { Resolution } from '../../src/types.js'

const graphqlURL = 'http://localhost:3000/graphql'

const fetchGraphQL = (url: string = graphqlURL) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query Me { me { id name email } }' }),
  })

describe('createMSWInterceptor', () => {
  it('returns an object with start, stop and reset functions', () => {
    const interceptor = createMSWInterceptor(async () => ({ kind: 'passthrough' }))

    expect(typeof interceptor.start).toBe('function')
    expect(typeof interceptor.stop).toBe('function')
    expect(typeof interceptor.reset).toBe('function')
  })

  describe('a response resolution', () => {
    const body = { data: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } }
    const resolution: Resolution = { kind: 'response', status: 200, body }
    const interceptor = createMSWInterceptor(async () => resolution)

    beforeAll(() => interceptor.start())
    afterAll(() => interceptor.stop())

    it('sends the resolved body as-is, at the resolved status', async () => {
      const response = await fetchGraphQL()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(body)
    })
  })

  describe('a response resolution with a string body', () => {
    const resolution: Resolution = { kind: 'response', status: 502, body: '<html>Bad Gateway</html>' }
    const interceptor = createMSWInterceptor(async () => resolution)

    beforeAll(() => interceptor.start())
    afterAll(() => interceptor.stop())

    it('sends the string as the raw response body', async () => {
      const response = await fetchGraphQL()

      expect(response.status).toBe(502)
      expect(await response.text()).toBe('<html>Bad Gateway</html>')
    })
  })

  describe('a networkError resolution', () => {
    const interceptor = createMSWInterceptor(async () => ({ kind: 'networkError', message: 'Failed to fetch' }))

    beforeAll(() => interceptor.start())
    afterAll(() => interceptor.stop())

    it('makes the fetch itself reject', async () => {
      await expect(fetchGraphQL()).rejects.toThrow()
    })
  })

  describe('a passthrough resolution', () => {
    const interceptor = createMSWInterceptor(async () => ({ kind: 'passthrough' }))

    beforeAll(() => interceptor.start())
    afterAll(() => interceptor.stop())

    it('lets the request through unhandled', async () => {
      await expect(fetchGraphQL('http://localhost:9/does-not-resolve')).rejects.toThrow()
    })
  })
})
