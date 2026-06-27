# whurl

**whurl** intercepts HTTP calls in tests at the network layer — no `vi.mock()` calls, your real client code runs. For GraphQL endpoints it validates queries and data shapes against your schema using [graphql-js](https://github.com/graphql/graphql-js), the GraphQL Foundation's reference implementation. For any other endpoint — REST APIs, OAuth providers, external services — it works as a thin wrapper over MSW. Either way, every intercepted call can be recorded as a Hurl file and replayed against a real backend later.

If you've wanted a GraphQL schema to act as a contract between frontend and backend — the way a Swagger file does for REST — whurl is built for that, although it solves the problem differently.

**whurl** combines two libraries: [msw](https://mswjs.io/) (Mock Service Worker) for HTTP interception in tests, and [Hurl](https://hurl.dev/) for contract verification against real backends. The name comes from **W**orker and **H**url.

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

For a GraphQL endpoint, provide the schema string. whurl parses it immediately and throws if it is invalid:

```ts
import { registerWithSchema } from '@nicholasf/whurl'

registerWithSchema('http://localhost:3000/graphql', `
  type User { id: ID! name: String! email: String! }
  type Query { me: User }
`)
```

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
