import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { register, registerWithSchema, reset, specify, specifyNetworkError, _getEndpoint } from '../src/index.js'
import type { Endpoint, Specification } from '../src/types.js'
import { schema } from './schema.js'

const graphqlURL = 'http://localhost:3000/graphql'
const restURL = 'http://localhost:3000/api'

// Avoids asserting against graphql-js's exact canonical print() format —
// only that a specification was stored, and which one, by position.
const graphqlSpecificationsFor = (endpoint: Endpoint): Specification[] => [...endpoint.graphqlSpecifications.values()].flat()

const meDocument = `query Me { me { id name email } }`
const postsDocument = `query Posts { posts { id title body author { id name email } } }`
const createPostDocument = `mutation CreatePost { createPost { id title body author { id name email } } }`
const deletePostDocument = `mutation DeletePost { deletePost }`

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
      specify({
        operationName: 'Me',
        document: meDocument,
        variables: {},
        response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } },
      })

      const endpoint = _getEndpoint(graphqlURL)
      expect(graphqlSpecificationsFor(endpoint)).toHaveLength(1)
    })

    it('stores a list query specification on the endpoint', () => {
      specify({
        operationName: 'Posts',
        document: postsDocument,
        variables: {},
        response: {
          posts: [
            { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } },
          ],
        },
      })

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.graphqlSpecifications.size).toBe(1)
    })

    it('stores a mutation specification on the endpoint', () => {
      specify({
        operationName: 'CreatePost',
        document: createPostDocument,
        variables: {},
        response: { createPost: { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } },
      })

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.graphqlSpecifications.size).toBe(1)
    })

    it('stores a boolean mutation specification on the endpoint', () => {
      specify({
        operationName: 'DeletePost',
        document: deletePostDocument,
        variables: {},
        response: { deletePost: true },
      })

      const endpoint = _getEndpoint(graphqlURL)
      expect(endpoint.graphqlSpecifications.size).toBe(1)
    })

    it('throws when data does not match the schema', () => {
      expect(() =>
        specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { nonExistentField: 'value' } } })
      ).toThrow()
    })

    it('throws when the given operationName does not match the document', () => {
      expect(() =>
        specify({ operationName: 'NotMe', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })
      ).toThrow(`operationName 'NotMe' does not match the operation named 'Me'`)
    })

    it('throws when no endpoint is registered', () => {
      reset()
      expect(() =>
        specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })
      ).toThrow()
    })

    it('sets remaining to 1 when stored', () => {
      specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })

      const endpoint = _getEndpoint(graphqlURL)
      const [specification] = graphqlSpecificationsFor(endpoint)
      expect(specification!.remaining).toBe(1)
    })

    it('sets remaining to n when .repeat(n) is chained', () => {
      specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } }).repeat(3)

      const endpoint = _getEndpoint(graphqlURL)
      const [specification] = graphqlSpecificationsFor(endpoint)
      expect(specification!.remaining).toBe(3)
    })
  })

  describe('request interception', () => {
    it('returns specified data for a query', async () => {
      specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })

      const response = await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: meDocument }),
      })

      const { data } = await response.json()
      expect(data).toEqual({ me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })
    })

    it('returns specified data for a mutation', async () => {
      specify({
        operationName: 'CreatePost',
        document: createPostDocument,
        variables: {},
        response: { createPost: { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } },
      })

      const response = await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: createPostDocument }),
      })

      const { data } = await response.json()
      expect(data).toEqual({
        createPost: { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } }
      })
    })

    it('matches a query with variables only when the variables match', async () => {
      const withVariablesDocument = `query Post($id: ID!) { post(id: $id) { id title body author { id name email } } }`

      specify({
        operationName: 'Post',
        document: withVariablesDocument,
        variables: { id: '1' },
        response: { post: { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } },
      })

      // No specification matches these variables, so the request passes
      // through to the real (non-existent) host and the fetch itself fails —
      // the same passthrough behaviour exercised in interceptors/msw.test.ts.
      await expect(
        fetch(graphqlURL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: withVariablesDocument, variables: { id: '2' } }),
        })
      ).rejects.toThrow()

      const rightVariables = await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: withVariablesDocument, variables: { id: '1' } }),
      })
      const { data } = await rightVariables.json()
      expect(data).toEqual({ post: { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })
    })

    it('does not confuse a document with a different shape but the same operation name', async () => {
      const shortMeDocument = `query Me { me { id } }`

      specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })

      // shortMeDocument has the same operation name but a different shape,
      // so it doesn't match the registered document — the request passes
      // through to the real (non-existent) host and the fetch itself fails.
      await expect(
        fetch(graphqlURL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: shortMeDocument }),
        })
      ).rejects.toThrow()
    })

    it('is insensitive to whitespace differences between the registered and sent document', async () => {
      const formattedMeDocument = `
        query Me {
          me {
            id
            name
            email
          }
        }
      `

      specify({ operationName: 'Me', document: formattedMeDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })

      const response = await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: meDocument }),
      })

      const { data } = await response.json()
      expect(data).toEqual({ me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })
    })

    it('decrements remaining after a request', async () => {
      specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })

      await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: meDocument }),
      })

      const endpoint = _getEndpoint(graphqlURL)
      const [specification] = graphqlSpecificationsFor(endpoint)
      expect(specification!.remaining).toBe(0)
    })

    it('serves the specification n times when .repeat(n) is set', async () => {
      specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } }).repeat(2)

      const fetchMe = () => fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: meDocument }),
      })

      const first = await (await fetchMe()).json()
      const second = await (await fetchMe()).json()

      expect(first.data).toEqual({ me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })
      expect(second.data).toEqual({ me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })

      const endpoint = _getEndpoint(graphqlURL)
      const [specification] = graphqlSpecificationsFor(endpoint)
      expect(specification!.remaining).toBe(0)
    })

    it('serves a second registration of the same document and variables only after the first is exhausted', async () => {
      specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })
      specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '2', name: 'Luke Skywalker', email: 'luke.skywalker@example.com' } } })

      const fetchMe = () => fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: meDocument }),
      })

      const first = await (await fetchMe()).json()
      const second = await (await fetchMe()).json()

      expect(first.data.me.id).toBe('1')
      expect(second.data.me.id).toBe('2')
    })

    it('registers each entry of an array independently, matched by its own variables', async () => {
      const postDocument = `query Post($id: ID!) { post(id: $id) { id title body author { id name email } } }`

      const handles = specify([
        { operationName: 'Post', document: postDocument, variables: { id: '1' }, response: { post: { id: '1', title: 'First post', body: 'Hello', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } } },
        { operationName: 'Post', document: postDocument, variables: { id: '2' }, response: { post: { id: '2', title: 'Second post', body: 'Hi', author: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } } },
      ])

      expect(handles).toHaveLength(2)

      const fetchPost = (id: string) => fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: postDocument, variables: { id } }),
      })

      const first = await (await fetchPost('1')).json()
      const second = await (await fetchPost('2')).json()

      expect(first.data.post.title).toBe('First post')
      expect(second.data.post.title).toBe('Second post')
    })
  })
})

describe('verbose logging', () => {
  beforeEach(() => {
    registerWithSchema(graphqlURL, schema)
    process.env['WHURL_VERBOSE'] = 'true'
  })

  afterEach(() => {
    delete process.env['WHURL_VERBOSE']
    vi.restoreAllMocks()
  })

  it('logs the Hurl-formatted request to stdout when a GraphQL spec is matched', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    specify({ operationName: 'Me', document: meDocument, variables: {}, response: { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } } })

    await fetch(graphqlURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: meDocument }),
    })

    expect(spy).toHaveBeenCalledWith(
      `POST ${graphqlURL}\nContent-Type: application/json\n\n${JSON.stringify({ query: meDocument }, null, 2)}`
    )
  })

  it('logs the Hurl-formatted request to stdout when a REST spec is matched', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    register(restURL)
    specify({ operationName: 'GetAccount', method: 'GET', response: { id: '1', name: 'Darth Vader' } })

    await fetch(restURL, { method: 'GET' })

    expect(spy).toHaveBeenCalledWith(`GET ${restURL}`)
  })
})

describe('non-GraphQL specifications', () => {
  beforeEach(() => {
    register(restURL)
  })

  it('stores a REST specification on the endpoint', () => {
    specify({ operationName: 'GetAccount', method: 'GET', response: { id: '1', name: 'Darth Vader' } })

    const endpoint = _getEndpoint(restURL)
    expect(endpoint.specifications.has('GET')).toBe(true)
    expect(endpoint.specifications.get('GET')?.operationName).toBe('GetAccount')
  })

  it('throws when no plain endpoint is registered', () => {
    reset()
    expect(() => specify({ operationName: 'GetAccount', method: 'GET', response: { id: '1' } })).toThrow('No plain endpoint registered.')
  })

  it('returns specified data for a GET request', async () => {
    specify({ operationName: 'GetAccount', method: 'GET', response: { id: '1', name: 'Darth Vader' } })

    const response = await fetch(restURL, { method: 'GET' })
    const data = await response.json()

    expect(data).toEqual({ data: { id: '1', name: 'Darth Vader' } })
  })
})

describe('multiple registrations', () => {
  const accountsURL = 'http://localhost:3000/api/accounts'
  const postsURL = 'http://localhost:3000/api/posts'

  it('multiple endpoints can coexist', () => {
    register(accountsURL)
    register(postsURL)
    registerWithSchema(graphqlURL, schema)

    expect(_getEndpoint(accountsURL)).toBeDefined()
    expect(_getEndpoint(postsURL)).toBeDefined()
    expect(_getEndpoint(graphqlURL)).toBeDefined()
  })

  it('specify resolves to the correct endpoint when a URL is provided', () => {
    register(accountsURL)
    register(postsURL)

    specify({ operationName: 'GetAccount', url: accountsURL, method: 'GET', response: { id: '1' } })
    specify({ operationName: 'GetPost', url: postsURL, method: 'GET', response: { id: '2' } })

    expect(_getEndpoint(accountsURL).specifications.get('GET')?.operationName).toBe('GetAccount')
    expect(_getEndpoint(postsURL).specifications.get('GET')?.operationName).toBe('GetPost')
  })
})

describe('an explicit status on specify', () => {
  describe('GraphQL form', () => {
    beforeEach(() => {
      registerWithSchema(graphqlURL, schema)
    })

    it('sends the response unwrapped and unvalidated, at the given status', async () => {
      specify({ status: 403, operationName: 'Me', document: meDocument, variables: {}, response: { errors: [{ message: 'forbidden', extensions: { code: 'UNAUTHORISED' } }] } })

      const response = await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: meDocument }),
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ errors: [{ message: 'forbidden', extensions: { code: 'UNAUTHORISED' } }] })
    })

    it('defaults to status 200 when the status is a GraphQL error riding on a normal response', async () => {
      specify({ status: 200, operationName: 'Me', document: meDocument, variables: {}, response: { errors: [{ message: 'forbidden' }] } })

      const response = await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: meDocument }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ errors: [{ message: 'forbidden' }] })
    })

    it('sends a string body as-is, unparsed as JSON', async () => {
      specify({ status: 200, operationName: 'Me', document: meDocument, variables: {}, response: 'not valid json' })

      const response = await fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: meDocument }),
      })

      const clone = response.clone()
      expect(await response.text()).toBe('not valid json')
      await expect(clone.json()).rejects.toThrow()
    })
  })

  describe('REST form', () => {
    beforeEach(() => {
      register(restURL)
    })

    it('sends the response unwrapped, at the given status', async () => {
      specify({ status: 401, operationName: 'GetAccount', method: 'GET', response: { error: 'invalid_grant', error_description: 'Refresh token expired' } })

      const response = await fetch(restURL, { method: 'GET' })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'invalid_grant', error_description: 'Refresh token expired' })
    })
  })

  describe('REST form with an explicit URL', () => {
    const accountsURL = 'http://localhost:3000/api/accounts'
    const postsURL = 'http://localhost:3000/api/posts'

    beforeEach(() => {
      register(accountsURL)
      register(postsURL)
    })

    it('resolves to the correct endpoint and sends the response unwrapped, at the given status', async () => {
      specify({ status: 403, operationName: 'GetAccount', url: accountsURL, method: 'GET', response: { error: 'access_denied' } })

      const response = await fetch(accountsURL, { method: 'GET' })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'access_denied' })
    })
  })
})

describe('specifyNetworkError', () => {
  beforeEach(() => {
    registerWithSchema(graphqlURL, schema)
  })

  it('makes the call reject instead of resolving', async () => {
    specifyNetworkError({ operationName: 'Me', document: meDocument })

    await expect(
      fetch(graphqlURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: meDocument }),
      })
    ).rejects.toThrow('Failed to fetch')
  })

  it('decrements remaining after a request, same as a response specification', async () => {
    specifyNetworkError({ operationName: 'Me', document: meDocument })

    await fetch(graphqlURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: meDocument }),
    }).catch(() => {})

    const endpoint = _getEndpoint(graphqlURL)
    const [specification] = graphqlSpecificationsFor(endpoint)
    expect(specification!.remaining).toBe(0)
  })

  it('does not require a response body to match the schema, since there is no body', () => {
    const notAFieldDocument = `query NotAField { me { id } }`
    expect(() => specifyNetworkError({ operationName: 'NotAField', document: notAFieldDocument })).not.toThrow()
  })
})
