import { describe, it, expect, beforeEach } from 'vitest'
import { Client, fetchExchange } from '@urql/core'
import { reset, registerWithSchema, specify } from '../src/index.js'

// Shaped after https://countries.trevorblades.com/graphql (a public GraphQL API),
// but pointed at a URL that doesn't resolve to anything real: whurl's MSW
// interceptor sits in front of the fetch, so a real backend isn't needed to
// exercise a real urql Client + fetchExchange pipeline.
const endpoint = 'http://localhost:9999/graphql'

const schema = `
  type Country {
    code: ID!
    name: String!
  }

  type Query {
    country(code: ID!): Country
  }
`

const COUNTRY_QUERY = `
  query Country($code: ID!) {
    country(code: $code) {
      code
      name
    }
  }
`

beforeEach(() => {
  reset()
  registerWithSchema(endpoint, schema)
})

describe('urql against a real GraphQL client pipeline', () => {
  it('intercepts an urql query and returns the specified mock data', async () => {
    specify('Country', { country: { code: 'BR', name: 'Testlandia' } })

    const client = new Client({ url: endpoint, exchanges: [fetchExchange] })
    const result = await client.query(COUNTRY_QUERY, { code: 'BR' }).toPromise()

    // urql defaults to GET for short queries. If whurl fails to match a GET
    // request, it passes through unhandled and the fetch fails against this
    // non-existent host instead of returning the mocked "Testlandia" data.
    expect(result.error).toBeUndefined()
    expect(result.data?.country?.name).toBe('Testlandia')
  })
})
