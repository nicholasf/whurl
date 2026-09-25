import type { GraphQLSchema } from 'graphql'

/** A registered endpoint — holds its URL, an optional GraphQL schema, and its specifications. */
export type Endpoint = {
  url: EndpointURL
  schema?: GraphQLSchema
  specifications: Map<string, Specification>
}

/** A URL string identifying a registered endpoint. */
export type EndpointURL = string

/** Manages the lifecycle of the HTTP interception layer. */
export interface Interceptor {
  start(): void
  stop(): void
  reset(): void
}

/** Context passed to a Reporter when a specification is consumed. */
export type ReportContext = {
  operationName: string
  url: EndpointURL
  method: string
  query: string
}

/** Abstracts the output format for consumed specifications. */
export interface Reporter {
  report(context: ReportContext): Promise<void>
}

/** Registers a plain HTTP endpoint with no schema validation. */
export type RegisterFn = (url: EndpointURL) => void

/** Registers a GraphQL endpoint, parsing and validating the schema string immediately. */
export type RegisterWithSchemaFn = (url: EndpointURL, schemaString: string) => void

/** Returned by specify — allows chaining .repeat(n) to set how many times the specification can be matched. */
export type SpecificationHandle = {
  repeat: (n: number) => void
}

/** A single specification stored on an endpoint. Matched up to remaining times before exhaustion. */
export type Specification =
  | { kind: 'response'; operationName?: string; method?: string; status: number; body: unknown; remaining: number }
  | { kind: 'networkError'; operationName?: string; method?: string; remaining: number }

/** The response data shape a plain (no leading status) specify() call takes. */
export type SpecifyData = Record<string, unknown>

/**
 * The body a specify() call with a leading status takes. A string is a
 * deliberately unparseable body — there is no other way to reach one, since
 * any plain object serializes to valid JSON.
 */
export type SpecifyBody = SpecifyData | string

/**
 * What the interceptor should do with a matched (or unmatched) request.
 * `response` covers both success and failure — the status decides which —
 * and `networkError` covers the one case that is not a response at all.
 */
export type Resolution =
  | { kind: 'passthrough' }
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'networkError' }

/**
 * Declares a specification on a registered endpoint. The plain (operationName,
 * data) form wraps data in a { data } envelope and defaults to status 200,
 * matching a plain successful response. Giving a leading status hands over
 * the response body as-is, unwrapped, so it can describe any shape, a
 * GraphQL errors array, a REST error body, or a deliberately malformed string.
 */
export type SpecifyFn = {
  (operationName: string, data: SpecifyData): SpecificationHandle
  (status: number, operationName: string, body: SpecifyBody): SpecificationHandle
  (operationName: string, method: string, data: SpecifyData): SpecificationHandle
  (status: number, operationName: string, method: string, body: SpecifyBody): SpecificationHandle
  (operationName: string, url: EndpointURL, method: string, data: SpecifyData): SpecificationHandle
  (status: number, operationName: string, url: EndpointURL, method: string, body: SpecifyBody): SpecificationHandle
}

/**
 * Declares that a call never reaches the server at all — the request fails
 * at the network layer, the way a real fetch() rejects on a dropped
 * connection or a DNS failure. Always surfaces as TypeError: Failed to
 * fetch — MSW's own network-error response carries no way to customize
 * that message.
 */
export type SpecifyNetworkErrorFn = (operationName: string) => SpecificationHandle
