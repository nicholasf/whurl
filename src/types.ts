import type { GraphQLSchema } from 'graphql'

/** A registered endpoint — holds its URL, an optional GraphQL schema, and its specifications. */
export type Endpoint = {
  url: EndpointURL
  schema?: GraphQLSchema
  specifications: Map<string, Specification>
  graphqlSpecifications: Map<string, Specification[]>
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

/**
 * A single specification stored on an endpoint, matched up to `remaining`
 * times before exhaustion. A GraphQL specification carries `variables`,
 * matched by deep equality against the incoming request's variables; a REST
 * specification doesn't.
 */
export type Specification =
  | { kind: 'response'; operationName?: string; method?: string; variables?: Record<string, unknown>; status: number; body: unknown; remaining: number }
  | { kind: 'networkError'; operationName?: string; method?: string; variables?: Record<string, unknown>; remaining: number }

/** The response shape a GraphQL specify() call's `response` field takes. */
export type SpecifyData = Record<string, unknown>

/**
 * The `response` a specify() call with an explicit `status` takes. A string
 * is a deliberately unparseable body — there is no other way to reach one,
 * since any plain object serializes to valid JSON.
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
 * Declares a GraphQL specification. A request is matched by parsing and
 * canonicalising both `document` and the incoming request's document and
 * comparing those, together with a deep-equality check of `variables`
 * against the incoming request's variables. `operationName` plays no part
 * in matching — it's cross-checked against the name found in `document` (a
 * mismatch is an error) and used for reporting.
 *
 * Omitting `status` wraps `response` in a { data } envelope, validates it
 * against the schema, and defaults to 200 — matching a plain successful
 * response. Giving `status` hands `response` over as-is, unwrapped and
 * unvalidated, since it can describe any shape: a GraphQL errors array, or a
 * deliberately malformed string.
 */
export type GraphQLSpecifyOptions = {
  status?: number
  operationName: string
  document: string
  variables: Record<string, unknown>
  response: SpecifyBody
}

/**
 * Declares a REST specification. `url` is only needed when more than one
 * plain endpoint is registered.
 */
export type RestSpecifyOptions = {
  status?: number
  operationName: string
  method: string
  url?: EndpointURL
  response: SpecifyBody
}

export type SpecifyOptions = GraphQLSpecifyOptions | RestSpecifyOptions

export type SpecifyFn = (options: SpecifyOptions) => SpecificationHandle

/**
 * Declares that a call never reaches the server at all — the request fails
 * at the network layer, the way a real fetch() rejects on a dropped
 * connection or a DNS failure. Always surfaces as TypeError: Failed to
 * fetch — MSW's own network-error response carries no way to customize
 * that message. `document` and `variables` are matched the same way as in
 * GraphQLSpecifyOptions; `variables` defaults to `{}` when omitted.
 */
export type SpecifyNetworkErrorOptions = {
  operationName: string
  document: string
  variables?: Record<string, unknown>
}

export type SpecifyNetworkErrorFn = (options: SpecifyNetworkErrorOptions) => SpecificationHandle
