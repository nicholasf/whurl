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

/** A single specification stored on an endpoint, consumed once by default. */
export type Specification = {
  operationName?: string
  query?: string
  data: SpecifyData
  consumed: boolean
}

/** The response data shape returned by a specification. */
export type SpecifyData = Record<string, unknown>

/** Declares a specification on a registered endpoint. Accepts two or three arguments. */
export type SpecifyFn = {
  (operationName: string, data: SpecifyData): void
  (operationName: string, verbOrUrl: string, data: SpecifyData): void
}
