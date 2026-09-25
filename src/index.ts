// whurl — GraphQL test double and contract layer
import { isDeepStrictEqual } from 'node:util'
import {
  buildSchema,
  getNamedType,
  isObjectType,
  parse,
  print,
  Kind,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type OperationTypeNode,
} from 'graphql'
import { createMSWInterceptor } from './interceptors/msw.js'
import { createHurlReporter, formatHurlRequest } from './reporters/hurl.js'
import type {
  Endpoint,
  EndpointURL,
  GraphQLSpecifyOptions,
  RegisterFn,
  RegisterWithSchemaFn,
  Reporter,
  Resolution,
  Specification,
  SpecificationHandle,
  SpecifyBody,
  SpecifyData,
  SpecifyFn,
  SpecifyNetworkErrorFn,
  SpecifyNetworkErrorOptions,
  SpecifyOptions,
} from './types.js'

const registry = new Map<EndpointURL, Endpoint>()

let reporter: Reporter | null = null
if (Object.is(process.env['WHURL'], 'true')) {
  reporter = createHurlReporter()
}

// Endpoints are matched on origin + pathname. GraphQL clients that send queries
// via GET (urql defaults to this when the query fits in the URL, and Apollo/
// graphql-request support it too) append query/operationName/variables as URL
// search params, so matching on the full URL would miss every GET request.
const normalizeURL = (url: string): EndpointURL => {
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname}`
}

const parseGraphQLRequest = async (request: Request): Promise<{ query: string; variables: Record<string, unknown> }> => {
  if (Object.is(request.method, 'GET')) {
    const searchParams = new URL(request.url).searchParams

    let query = searchParams.get('query')
    if (!query) {
      query = ''
    }

    let variables: Record<string, unknown> = {}
    const rawVariables = searchParams.get('variables')
    if (rawVariables) {
      try {
        variables = JSON.parse(rawVariables)
      } catch {
        variables = {}
      }
    }

    return { query, variables }
  }

  try {
    // Clone before reading the body: MSW's passthrough() re-sends the
    // original request, which fails once its body stream is consumed.
    const body = await request.clone().json() as { query?: string; variables?: Record<string, unknown> }

    let query = body.query
    if (!query) {
      query = ''
    }

    let variables = body.variables
    if (!variables) {
      variables = {}
    }

    return { query, variables }
  } catch {
    return { query: '', variables: {} }
  }
}

// A document is compared by parsing it and printing it back out, so two
// documents that differ only in whitespace or formatting are recognised as
// the same document. Raw string comparison would treat them as different.
const canonicalise = (document: string): string => print(parse(document))

const deriveOperation = (document: string): { name: string; type: OperationTypeNode } => {
  const parsedDocument = parse(document)
  const operation = parsedDocument.definitions.find(
    (definition): definition is OperationDefinitionNode => Object.is(definition.kind, Kind.OPERATION_DEFINITION)
  )

  if (!operation) {
    throw new Error(`No operation found in document:\n${document}`)
  }
  if (!operation.name) {
    throw new Error(`Operation must be named:\n${document}`)
  }

  return { name: operation.name.value, type: operation.operation }
}

const resolveSpecification = (specification: Specification): Resolution => {
  if ('status' in specification) {
    return { kind: 'response', status: specification.status, body: specification.body }
  }
  return { kind: 'networkError' }
}

const resolveRequest = async (request: Request): Promise<Resolution> => {
  const endpoint = registry.get(normalizeURL(request.url))
  if (!endpoint) return { kind: 'passthrough' }

  if (endpoint.schema) {
    const { query, variables } = await parseGraphQLRequest(request)
    if (!query) return { kind: 'passthrough' }

    let canonicalDocument: string
    try {
      canonicalDocument = canonicalise(query)
    } catch {
      return { kind: 'passthrough' }
    }

    const candidates = endpoint.graphqlSpecifications.get(canonicalDocument)
    if (!candidates) return { kind: 'passthrough' }

    const specification = candidates.find(
      (candidate) => candidate.remaining > 0 && isDeepStrictEqual(candidate.variables, variables)
    )
    if (!specification) return { kind: 'passthrough' }

    specification.remaining -= 1

    let operationName = specification.operationName
    if (!operationName) {
      operationName = 'unknown'
    }
    const graphqlContext = { operationName, url: endpoint.url, method: request.method, query }

    if (reporter) {
      await reporter.report(graphqlContext)
    }

    if (Object.is(process.env['WHURL_VERBOSE'], 'true')) {
      console.log(formatHurlRequest(graphqlContext))
    }

    return resolveSpecification(specification)
  }

  const method = request.method.toUpperCase()
  const specification = endpoint.specifications.get(method)
  if (!specification || specification.remaining <= 0) return { kind: 'passthrough' }

  specification.remaining -= 1

  let restOperationName = specification.operationName
  if (!restOperationName) {
    restOperationName = method
  }
  const restContext = { operationName: restOperationName, url: endpoint.url, method, query: '' }

  if (reporter) {
    await reporter.report(restContext)
  }

  if (Object.is(process.env['WHURL_VERBOSE'], 'true')) {
    console.log(formatHurlRequest(restContext))
  }

  return resolveSpecification(specification)
}

const interceptor = createMSWInterceptor(resolveRequest)

export const start = (): void => interceptor.start()
export const stop = (): void => interceptor.stop()

export const reset = (): void => {
  registry.clear()
}

export const _getEndpoint = (url: EndpointURL): Endpoint => {
  const endpoint = registry.get(normalizeURL(url))
  if (!endpoint) {
    throw new Error(`No endpoint registered for URL: ${url}`)
  }
  return endpoint
}

const validateURL = (url: string): void => {
  try {
    new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
}

const findRestEndpoint = (): Endpoint => {
  const restEndpoints = [...registry.values()].filter(e => !e.schema)
  if (restEndpoints.length < 1) {
    throw new Error('No plain endpoint registered. Call register first.')
  }
  if (restEndpoints.length > 1) {
    throw new Error('Multiple plain endpoints registered. Specify a URL as the second argument.')
  }
  return restEndpoints[0]!
}

const findGraphQLEndpoint = (): Endpoint => {
  const graphqlEndpoints = [...registry.values()].filter(e => Boolean(e.schema))
  if (graphqlEndpoints.length < 1) {
    throw new Error('No GraphQL endpoint registered. Call registerWithSchema first.')
  }
  if (graphqlEndpoints.length > 1) {
    throw new Error('Multiple GraphQL endpoints registered. Use the three-argument form to specify a URL.')
  }
  return graphqlEndpoints[0]!
}

const rootTypeForOperation = (schema: GraphQLSchema, operationType: OperationTypeNode) => {
  const rootTypeGetters: Record<OperationTypeNode, () => ReturnType<GraphQLSchema['getQueryType']>> = {
    query: () => schema.getQueryType(),
    mutation: () => schema.getMutationType(),
    subscription: () => schema.getSubscriptionType(),
  }
  return rootTypeGetters[operationType]()
}

const validateSpecificationData = (
  operationName: string,
  operationType: OperationTypeNode,
  data: SpecifyData,
  schema: GraphQLSchema
): void => {
  const keys = Object.keys(data)
  if (keys.length < 1 || keys.length > 1) {
    throw new Error(
      `Expected response data for '${operationName}' to have exactly one top-level key (the field name), got: ${keys.join(', ') || '(none)'}`
    )
  }
  const fieldName = keys[0]!

  const rootType = rootTypeForOperation(schema, operationType)
  const field = rootType?.getFields()[fieldName]

  if (!field) {
    throw new Error(
      `No ${operationType} field named '${fieldName}' found on the schema's ${operationType} type (from specify({ operationName: '${operationName}', ... }))`
    )
  }

  const namedType = getNamedType(field.type)
  const responseValue = data[fieldName]

  if (isObjectType(namedType) && Object.is(typeof responseValue, 'object') && Boolean(responseValue) && !Array.isArray(responseValue)) {
    const typeFields = namedType.getFields()
    for (const key of Object.keys(responseValue as Record<string, unknown>)) {
      if (!(key in typeFields)) {
        throw new Error(`Field '${key}' does not exist on type '${namedType.name}'`)
      }
    }
  }
}

export const register: RegisterFn = (url: EndpointURL): void => {
  validateURL(url)
  const key = normalizeURL(url)
  if (registry.has(key)) {
    throw new Error(`Endpoint already registered: ${url}`)
  }
  registry.set(key, { url, specifications: new Map(), graphqlSpecifications: new Map() })
}

export const registerWithSchema: RegisterWithSchemaFn = (url: EndpointURL, schemaString: string): void => {
  validateURL(url)
  const key = normalizeURL(url)
  if (registry.has(key)) {
    throw new Error(`Endpoint already registered: ${url}`)
  }
  const schema = buildSchema(schemaString)
  registry.set(key, { url, schema, specifications: new Map(), graphqlSpecifications: new Map() })
}

const toResponse = (status: number | undefined, body: SpecifyBody): { status: number; body: unknown } => {
  if (!status) {
    return { status: 200, body: { data: body } }
  }
  return { status, body }
}

const isGraphQLOptions = (options: SpecifyOptions): options is GraphQLSpecifyOptions => 'document' in options

const pushGraphQLSpecification = (endpoint: Endpoint, canonicalDocument: string, specification: Specification): void => {
  let queue = endpoint.graphqlSpecifications.get(canonicalDocument)
  if (!queue) {
    queue = []
    endpoint.graphqlSpecifications.set(canonicalDocument, queue)
  }
  queue.push(specification)
}

const checkOperationNameMatchesDocument = (operationName: string, document: string): OperationTypeNode => {
  const { name, type } = deriveOperation(document)
  if (!Object.is(name, operationName)) {
    throw new Error(`operationName '${operationName}' does not match the operation named '${name}' found in the given document`)
  }
  return type
}

// A plain (no status) call wraps its response in a { data } envelope and is
// validated against the schema, matching a plain successful response. An
// explicit status hands the response over as-is, unwrapped and unvalidated,
// since it can describe any shape: an errors array, a REST error body, or a
// deliberately malformed string.
export const specify: SpecifyFn = (options: SpecifyOptions): SpecificationHandle => {
  if (isGraphQLOptions(options)) {
    const endpoint = findGraphQLEndpoint()
    const operationType = checkOperationNameMatchesDocument(options.operationName, options.document)
    const canonicalDocument = canonicalise(options.document)
    const { status, body } = toResponse(options.status, options.response)

    if (!options.status && endpoint.schema) {
      validateSpecificationData(options.operationName, operationType, options.response as SpecifyData, endpoint.schema)
    }

    const specification: Specification = {
      kind: 'response',
      operationName: options.operationName,
      variables: options.variables,
      status,
      body,
      remaining: 1,
    }
    pushGraphQLSpecification(endpoint, canonicalDocument, specification)
    return { repeat: (n: number) => { specification.remaining = n } }
  }

  let endpoint: Endpoint
  if (options.url) {
    const found = registry.get(normalizeURL(options.url))
    if (!found) {
      throw new Error(`No endpoint registered for URL: ${options.url}`)
    }
    endpoint = found
  } else {
    endpoint = findRestEndpoint()
  }

  const { status, body } = toResponse(options.status, options.response)
  const specification: Specification = {
    kind: 'response',
    operationName: options.operationName,
    method: options.method.toUpperCase(),
    status,
    body,
    remaining: 1,
  }
  endpoint.specifications.set(options.method.toUpperCase(), specification)
  return { repeat: (n: number) => { specification.remaining = n } }
}

export const specifyNetworkError: SpecifyNetworkErrorFn = (options: SpecifyNetworkErrorOptions): SpecificationHandle => {
  const endpoint = findGraphQLEndpoint()
  checkOperationNameMatchesDocument(options.operationName, options.document)
  const canonicalDocument = canonicalise(options.document)

  let variables = options.variables
  if (!variables) {
    variables = {}
  }

  const specification: Specification = {
    kind: 'networkError',
    operationName: options.operationName,
    variables,
    remaining: 1,
  }
  pushGraphQLSpecification(endpoint, canonicalDocument, specification)
  return { repeat: (n: number) => { specification.remaining = n } }
}
