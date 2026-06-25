import { describe, it, expect, beforeEach } from 'vitest'
import { register, registerWithSchema, reset, specify, _getEndpoint } from '../src/index.js'
import { schema } from './schema.js'

const graphqlURL = 'http://localhost:3000/graphql'
const restURL = 'http://localhost:3000/api'

beforeEach(() => {
  reset()
})

describe('register', () => {
  it('registers a valid URL', () => {
    expect(() => register(restURL)).not.toThrow()
  })

  it('throws on an invalid URL', () => {
    expect(() => register('not-a-url')).toThrow('Invalid URL: not-a-url')
  })

  it('throws on a duplicate URL', () => {
    register(restURL)
    expect(() => register(restURL)).toThrow(`Endpoint already registered: ${restURL}`)
  })
})

describe('registerWithSchema', () => {
  it('registers a valid URL with a valid schema', () => {
    expect(() => registerWithSchema(graphqlURL, schema)).not.toThrow()
  })

  it('throws on an invalid URL', () => {
    expect(() => registerWithSchema('not-a-url', schema)).toThrow('Invalid URL: not-a-url')
  })

  it('throws on a duplicate URL', () => {
    registerWithSchema(graphqlURL, schema)
    expect(() => registerWithSchema(graphqlURL, schema)).toThrow(`Endpoint already registered: ${graphqlURL}`)
  })

  it('throws on an invalid GraphQL schema', () => {
    expect(() => registerWithSchema(graphqlURL, 'not a schema')).toThrow()
  })
})

describe('GraphQL specifications', () => {
  beforeEach(() => {
    registerWithSchema(graphqlURL, schema)
  })

  describe('specification storage', () => {
    it('stores a query specification on the endpoint', () => {
      specify('Me', { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.specifications.has('Me')).toBe(true)
    })

    it('stores a list query specification on the endpoint', () => {
      specify('Posts', {
        posts: [
          { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } },
        ]
      })

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.specifications.has('Posts')).toBe(true)
    })

    it('stores a mutation specification on the endpoint', () => {
      specify('CreatePost', {
        createPost: { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } }
      })

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.specifications.has('CreatePost')).toBe(true)
    })

    it('stores a boolean mutation specification on the endpoint', () => {
      specify('DeletePost', { deletePost: true })

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.specifications.has('DeletePost')).toBe(true)
    })

    it('throws when data does not match the schema', () => {
      expect(() => specify('Me', { me: { nonExistentField: 'value' } })).toThrow()
    })

    it('throws when no endpoint is registered', () => {
      reset()
      expect(() => specify('Me', { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })).toThrow()
    })

    it('sets remaining to 1 when stored', () => {
      specify('Me', { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.specifications.get('Me')?.remaining).toBe(1)
    })

    it('sets remaining to n when .repeat(n) is chained', () => {
      specify('Me', { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } }).repeat(3)

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.specifications.get('Me')?.remaining).toBe(3)
    })
  })

  describe('request interception', () => {
    it('returns specified data for a query', async () => {
      specify('Me', { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })

      const response = await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query Me { me { id name email } }' }),
      })

      const { data } = await response.json()
      expect(data).toEqual({ me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })
    })

    it('returns specified data for a mutation', async () => {
      specify('CreatePost', {
        createPost: { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } }
      })

      const response = await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'mutation CreatePost { createPost { id title body author { id name email } } }' }),
      })

      const { data } = await response.json()
      expect(data).toEqual({
        createPost: { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } }
      })
    })

    it('decrements remaining after a request', async () => {
      specify('Me', { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })

      await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query Me { me { id name email } }' }),
      })

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.specifications.get('Me')?.remaining).toBe(0)
    })

    it('serves the specification n times when .repeat(n) is set', async () => {
      specify('Me', { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } }).repeat(2)

      const fetchMe = () => fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query Me { me { id name email } }' }),
      })

      const first = await (await fetchMe()).json()
      const second = await (await fetchMe()).json()

      expect(first.data).toEqual({ me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })
      expect(second.data).toEqual({ me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })
      expect(_getEndpoint(graphqlURL).specifications.get('Me')?.remaining).toBe(0)
    })
  })
})

describe('non-GraphQL specifications', () => {
  it.todo('stores a REST specification on the endpoint')
  it.todo('throws when no endpoint is registered')
})

describe('multiple registrations', () => {
  it.todo('multiple endpoints can coexist')
  it.todo('specify resolves to the correct endpoint')
})
