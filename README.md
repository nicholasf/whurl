# sophistry

> **Note:** The name of this library is provisional and will change.

sophistry is a TypeScript npm library that provides a centralised GraphQL test double and contract layer, sitting between your frontend tests and your GraphQL backend.

## The Problem

Frontend and backend teams often need to work independently — the frontend outpaces the backend, or the backend is unavailable for local development. In a React+GraphQL test suite, each test typically assembles its own collection of mocks — `vi.fn()`, `vi.mock()`, module interception — to simulate the backend. This is a burden of its own. Each test builds a private world of fakes that drifts from reality over time, creates conceptual overhead for the reader, and gives false confidence.

sophistry addresses this by providing a single maintained layer that represents your GraphQL API via its schema, validated against it, and verifiable from both sides. At any point it can be run transparently — stepping aside entirely so requests flow through to the real backend — making it a coordination tool as much as a testing tool.

## How It Works

sophistry reads your GraphQL schema and uses it as the source of truth. Frontend tests declare specifications: schema-validated descriptions of what a GraphQL operation should return. These specifications serve as the contract between the two teams.

The backend does not need to be running for frontend tests. The frontend does not need to be running for the backend to verify the contract.

## Modes

sophistry operates in two modes:

### Specified

The primary mode. Tests declare what a GraphQL operation should return. sophistry validates the response shape against the schema and intercepts the request, returning the specified data. Specified responses can be hand-written or generated from the schema using a tool like faker.

Individual tests can specify exactly which schema-validated responses they need to exercise particular conditions — error states, empty results, edge cases.

#### Named operations required

sophistry matches specifications to intercepted requests by operation name. Every query and mutation in your codebase must be named:

```graphql
# ✓ named — sophistry can match this
query Me {
  me { id name username }
}

# ✗ unnamed — sophistry will throw at intercept time
{
  me { id name username }
}
```

Operation names are a client-side convention — they are chosen by the developer writing the query and have no presence in the GraphQL schema itself. The schema defines what fields are available; the operation name is simply a label the client puts on a particular query or mutation.

Naming operations is considered best practice in GraphQL regardless of sophistry. Named operations appear in server logs, are displayed by developer tools and GraphQL clients like urql devtools, and make the intent of each query explicit. sophistry enforces this as a hard requirement and uses the operation name as the key passed to `sophistry.specify()`.

If an unnamed operation is intercepted, sophistry throws immediately with a clear message indicating which query needs a name.

```ts
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { sophistry } from 'sophistry'
import { DashboardPage } from './pages/DashboardPage'

describe('DashboardPage', () => {
  it('renders a list of campaigns for the authenticated account', async () => {
    sophistry.specify('Me', {
      me: { id: 1, name: 'Nicholas', username: 'nicholasf' }
    })

    sophistry.specify('Campaigns', {
      campaigns: [
        { id: 1, name: 'The Lost Mine', description: 'A classic adventure', currentLevel: 3 },
        { id: 2, name: 'Curse of Strahd', description: null, currentLevel: 7 },
      ]
    })

    render(<DashboardPage />)

    expect(await screen.findByText('The Lost Mine')).toBeInTheDocument()
    expect(await screen.findByText('Curse of Strahd')).toBeInTheDocument()
    expect(screen.getByText('Level 3')).toBeInTheDocument()
  })

  it('renders an empty state when the account has no campaigns', async () => {
    sophistry.specify('Me', {
      me: { id: 1, name: 'Nicholas', username: 'nicholasf' }
    })

    sophistry.specify('Campaigns', { campaigns: [] })

    render(<DashboardPage />)

    expect(await screen.findByText('You have no campaigns yet.')).toBeInTheDocument()
  })
})
```

No `vi.mock()` calls, no module interception. The GraphQL client runs for real — sophistry intercepts at the network layer and returns schema-validated data.

### Transparent

sophistry steps aside entirely and lets requests pass through to the real backend. Used for integration and e2e testing.

## Hurl Export

When tests are run with the `SOPHISTRY_HURL=true` flag, sophistry writes a Hurl file for each specification as a side effect of the test run. These files can then be played against the real backend — no frontend required:

```bash
# Frontend team runs tests, producing hurl output as a side effect
SOPHISTRY_HURL=true vitest run

# Backend team verifies the contract against their implementation
hurl sophistry/*.hurl
```

There are two levels of assertion sophistry can generate:

**Shape assertions** verify that the response contains the expected fields with the expected types — `data.me.id` is a string, `data.me.email` is a string. These are derived directly from the schema and pass regardless of what data the backend holds. They are the natural first step: if the shape is wrong, nothing else matters.

**Value assertions** verify that specific values were returned. These are more precise but more brittle — they depend on the backend having particular data in a particular state. They are useful for testing specific conditions (an account with a specific status, a campaign at a specific level) but require coordination with the backend team around test data.

sophistry generates shape assertions by default. Value assertions can be added by the backend team as needed, or by sophistry when a specification declares a value that is meaningful to verify rather than merely illustrative.

Query arguments and identifiers are generated as Hurl variables, so the backend team supplies a thin variables file with real values rather than editing the Hurl files directly:

```bash
hurl sophistry/*.hurl --variables-file sophistry/vars.env
```

This creates a natural collaboration point — frontend and backend teams can agree on a shared set of common test values in `vars.env`, making the contract verification repeatable and consistent across both sides. Teams that want to go further can commit a `vars.env.example` alongside the Hurl output as a reference.

The output format is abstracted behind a `Reporter` interface, so future formats (Postman collections, HAR, etc.) can be added without changing sophistry's core.

## Schema as Contract

The GraphQL schema is the source of truth throughout. The backend owns and controls it. sophistry consumes it to validate specifications, making the schema function as the executable contract between teams — a GraphQL equivalent of an OpenAPI specification.

## Vitest Compatibility

sophistry intercepts at the HTTP layer via [msw](https://mswjs.io/), abstracted behind an interceptor interface so the underlying transport layer can be swapped. This means:

- Your GraphQL client, auth exchange, and component tree run for real — no `vi.mock('urql')` needed
- sophistry works alongside Vitest, Jest, or any other test runner
- Migration from existing mock-heavy tests is incremental: add sophistry's setup, then convert `vi.mock` calls to sophistry handlers one at a time

## REST Support

sophistry works with REST endpoints as well as GraphQL. The same specified and transparent modes apply, and Hurl export works the same way.

The difference: REST specifications are matched by HTTP method and URL pattern rather than GraphQL operation name, and there is no schema validation. Shape and structure must be asserted manually or via TypeScript types rather than derived from a schema.

```ts
sophistry.specify('GET /api/accounts/:id', {
  id: 1,
  name: 'Nicholas',
})
```

Hurl export and the `Reporter` interface work identically. Value and shape assertions in the exported Hurl files follow the same rules — backend teams supply a `vars.env` for path parameters like `:id`.

REST mode is useful for teams that are in the process of migrating from REST to GraphQL, or where some parts of the API remain REST-only.

## Status

Early development. The API is not yet stable and will change before the first release. The library name is also provisional.
