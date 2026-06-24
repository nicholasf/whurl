# sophistry

sophistry is a standalone TypeScript npm library that provides a centralized GraphQL test double and contract layer. It replaces the pattern of assembling per-test mock collections (vi.fn(), vi.mock() etc.) with a shared, maintained fake of a GraphQL backend that all tests import and build on.

## The Problem

In typical React+GraphQL frontend test suites, each test sets up its own world of mocks. These mocks become a burden — drifting from reality, creating conceptual overhead, and giving false confidence. sophistry centralizes this into a single maintained layer.

## Modes

sophistry operates in two distinct modes:

### Authored Mode
Used when the backend does not yet exist. The developer writes GraphQL response shapes manually, validated against the schema, as a formal contract between frontend and backend teams. These are explicitly provisional. The tooling will warn if an authored handler persists after a recorded fixture exists for the same operation.

### Recorded Mode
Once the backend exists, sophistry records real API responses and uses them as fixtures going forward. When the backend changes, you re-record.

## Lifecycle

The typical workflow follows this lifecycle:
1. **Authored** (provisional contract) → 2. **Recorded** (real fixture) → 3. **Handler deleted** (test talks to real backend in integration/e2e)

## DSL and Schema Validation

Handlers are expressed in GraphQL-native terms, validated against the schema. An authored handler reads like a typed fixture — both documentation and executable test double. It functions as a contract equivalent for GraphQL (similar to Swagger/OpenAPI for REST).

sophistry uses msw (Mock Service Worker) for HTTP interception under the hood, but users never configure msw handlers directly. sophistry's DSL sits above msw.

## Status

This project is in early development. The API is not yet stable and may change significantly before the first release.