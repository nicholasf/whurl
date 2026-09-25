# whurl

whurl mocks a GraphQL endpoint straight from its schema, validating every request and response against it, and mocks anything else, REST, OAuth, webhooks, the same way. Every specification can also be exported as a Hurl file and replayed against the real backend, so a test's mock logic becomes a repeatable contract check.

```ts
registerWithSchema('http://localhost:4000/graphql', schema)
register('http://auth.example.com/oauth/token')

// Success, status defaults to 200
specify('World', { world: { id: 1, name: 'Aerthos', description: 'A shattered realm', isActive: true } })

// GraphQL error, still a 200 by convention, made explicit here
specify(200, 'World', { errors: [{ message: 'forbidden', extensions: { code: 'UNAUTHORISED' } }] })

// A non-200 GraphQL response, e.g. behind a gateway that rejects before resolving
specify(500, 'World', { errors: [{ message: 'internal server error' }] })

// Repeat a specification across multiple matches
specify('Accounts', { accounts: [{ id: 1, name: 'Kestrel', username: 'kestrel_runs' }] }).repeat(3)

// REST, success, status defaults to 200
specify('ExchangeToken', 'POST', { access_token: 'sith-token-abc123', token_type: 'Bearer', expires_in: 3600 })

// REST, failure, explicit status
specify(401, 'ExchangeToken', 'POST', { error: 'invalid_grant', error_description: 'Refresh token expired' })

// The call never reaches the server at all, TypeError: Failed to fetch
specifyNetworkError('World')
```

**whurl** intercepts HTTP calls in tests at the network layer — no `vi.mock()` calls, your real client code runs. For GraphQL endpoints it validates queries and data shapes against your schema using [graphql-js](https://github.com/graphql/graphql-js), the GraphQL Foundation's reference implementation. For any other endpoint — REST APIs, OAuth providers, external services — it works as a thin wrapper over MSW. Either way, every intercepted call can be recorded as a Hurl file and replayed against a real backend later.

If you've wanted a GraphQL schema to act as a contract between frontend and backend — the way a Swagger file does for REST — whurl is built for that, although it solves the problem differently.

**whurl** combines two libraries: [msw](https://mswjs.io/) (Mock Service Worker) for HTTP interception in tests, and [Hurl](https://hurl.dev/) for contract verification against real backends. The name comes from **W**orker and **H**url.

It works at both the client and server layer. Despite the name, MSW's Node implementation doesn't run an actual browser Service Worker — it patches Node's own `http.ClientRequest.prototype` directly (see [Server-to-server calls](#server-to-server-calls)), so the same interception mocks a frontend component's call to your API just as well as a backend service's own outbound call to a downstream dependency. The example below is a React component, but that's just the example — whurl works the same way from a Node test with no browser involved.

```ts
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { registerWithSchema, specify, reset } from '@nicholasf/whurl'
import { DashboardPage } from './pages/DashboardPage'
import { schema } from '../tests/schema'

beforeEach(() => {
  reset()
  registerWithSchema('http://localhost:3000/graphql', schema)
})

describe('DashboardPage', () => {
  it('renders the authenticated user', async () => {
    specify('Me', {  // intercepts the 'Me' query DashboardPage fires on mount
      me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' }
    })

    render(<DashboardPage />)

    expect(await screen.findByText('Darth Vader')).toBeInTheDocument()
  })
})
```

Then, later on, after you are happy with your mock logic, you can whurl it at the backend!

Run your tests with `WHURL=true` and whurl writes a Hurl file for every consumed specification:

```bash
WHURL=true vitest run
```

The `Me` specification above produces `whurl/2026-06-25T11-38-15-Me.hurl`:

```
POST http://localhost:3000/graphql
Content-Type: application/json

{
  "query": "query Me { me { id name email } }"
}
```

The backend team runs this against their real implementation — no frontend required:

```bash
hurl whurl/*.hurl
```

## Installation

```bash
npm install @nicholasf/whurl
```

## Setup

Call `start()` and `stop()` in your test setup file:

```ts
// tests/setup.ts
import { beforeAll, afterAll } from 'vitest'
import { start, stop } from '@nicholasf/whurl'

beforeAll(() => start())
afterAll(() => stop())
```

```ts
// vitest.config.ts
export default {
  test: {
    setupFiles: ['./tests/setup.ts'],
  },
}
```

## Registering endpoints

For a plain HTTP endpoint:

```ts
import { register } from '@nicholasf/whurl'

register('http://localhost:3000/api/accounts')
```

For a GraphQL endpoint, provide the schema string. The schema isn't just parsed once and discarded — whurl keeps it, because every specification you declare later (see [Specifications](#specifications)) is checked against it. That's the difference between whurl and a plain stub: if a mocked response has a typo'd field name, references a field that doesn't exist on the type, or is missing a field the operation actually returns, whurl throws at `specify()` time — not later, as a confusing failure against the real API, or worse, not at all.

```ts
import { registerWithSchema } from '@nicholasf/whurl'

registerWithSchema('http://localhost:3000/graphql', `
  type User { id: ID! name: String! email: String! }
  type Query { me: User }
`)
```

whurl also parses the schema string immediately and throws if it's invalid, so a broken schema fails fast here rather than surfacing later as a confusing `specify()` error.

## Specifications

A specification declares what a GraphQL operation should return. whurl validates the response shape against the registered schema and intercepts the matching request, returning the specified data.

```ts
import { registerWithSchema, specify } from '@nicholasf/whurl'

registerWithSchema('http://localhost:3000/graphql', schema)

specify('Me', {
  me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' }
})
```

Operations must be named. whurl matches specifications to intercepted requests by operation name:

```graphql
# ✓ whurl can match this
query Me {
  me { id name email }
}

# ✗ whurl will throw at intercept time
{
  me { id name email }
}
```

By default a specification is matched once and then exhausted. Chain `.repeat(n)` to allow it to be matched more times:

```ts
specify('Me', { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } })          // matched once
specify('Me', { me: { id: '1', name: 'Darth Vader', email: 'darth.vader@example.com' } }).repeat(3) // matched three times
```

Call `reset()` between tests to clear all specifications and registered endpoints:

```ts
import { beforeEach } from 'vitest'
import { reset } from '@nicholasf/whurl'

beforeEach(() => reset())
```

## Plain HTTP endpoints

whurl can intercept any HTTP endpoint, not just GraphQL. This is useful for mocking OAuth providers, REST APIs, or any other HTTP dependency your components talk to during tests.

Register a plain endpoint with `register()`, then declare specifications using the three-argument form — operation name, HTTP method, and response data:

```ts
import { register, specify } from '@nicholasf/whurl'

register('http://auth.example.com/oauth/token')

specify('ExchangeToken', 'POST', {
  access_token: 'sith-token-abc123',
  token_type: 'Bearer',
  expires_in: 3600,
})
```

whurl is just MSW here — `register` + `specify` is a thin DSL over an MSW handler. The intercept, the response envelope, the lifecycle — all MSW. whurl adds the operation name as a label and the `.repeat(n)` lifetime on top.

## Server-to-server calls

whurl's interceptor uses `setupServer` from `msw/node`, not `msw/browser`. `msw/node` works by patching Node's own `http.ClientRequest.prototype` (and the equivalent hook for `fetch`/undici) directly in the process — there's no Service Worker or DOM involved. That patch catches any outgoing request made from that Node process, regardless of whether the caller is a React component's `fetch()` during a jsdom test or a backend service's own outbound call to a downstream API. Vitest already runs tests in a plain Node process by default, so this falls out for free:

```ts
import { register, specify, reset } from '@nicholasf/whurl'
import { getExchangeRate } from './exchangeRateService'

beforeEach(() => reset())

it('fetches the current exchange rate', async () => {
  register('https://api.exchangerate.example.com/latest')
  specify('GetRate', 'GET', { base: 'USD', rates: { EUR: 0.92 } })

  const rate = await getExchangeRate('EUR')

  expect(rate).toBe(0.92)
})
```

## Hurl export

When tests run with `WHURL=true`, whurl writes a Hurl file for each consumed specification:

```bash
WHURL=true vitest run
```

This produces files in `whurl/`:

```
whurl/2026-06-25T11-38-15-Me.hurl
whurl/2026-06-25T11-38-15-CreatePost.hurl
```

The backend team can then run these against their implementation — no frontend required:

```bash
hurl whurl/*.hurl
```

Query variables are expressed as Hurl variables so the backend team can supply real values via a variables file:

```bash
hurl whurl/*.hurl --variables-file whurl/vars.env
```

## Interceptor

HTTP interception is behind an `Interceptor` interface. The current implementation uses MSW, but the interface allows a different worker implementation to be swapped in without changing any test code:

```ts
interface Interceptor {
  start(): void
  stop(): void
  reset(): void
}
```

This means whurl is not tied to MSW specifically — any library that can intercept HTTP requests and return a response can be wired in by implementing this interface.

## Verbose mode

Set `WHURL_VERBOSE=true` to log each matched specification as a Hurl request to stdout as tests run:

```bash
WHURL_VERBOSE=true vitest run
```

Output for a GraphQL spec:

```
POST http://localhost:3000/graphql
Content-Type: application/json

{
  "query": "query Me { me { id name email } }"
}
```

Output for a plain HTTP spec:

```
GET http://localhost:3000/api/accounts
```

Verbose mode and `WHURL=true` file export are independent — both can be active at once.

## Status

Early development. The API is not yet stable and will change before the first release.
