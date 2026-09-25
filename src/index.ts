// whurl — GraphQL test double and contract layer
import { buildSchema, getNamedType, isObjectType, type GraphQLSchema } from 'graphql'
import { createMSWInterceptor } from './interceptors/msw.js'
import { createHurlReporter, formatHurlRequest } from './reporters/hurl.js'
import type {
  Endpoint,
  EndpointURL,
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
} from './types.js'

const registry = new Map<EndpointURL, Endpoint>()

const reporter: Reporter | null = process.env['WHURL'] === 'true'
  ? createHurlReporter()
  : null

// Endpoints are matched on origin + pathname. GraphQL clients that send queries
// via GET (urql defaults to this when the query fits in the URL, and Apollo/
// graphql-request support it too) append query/operationName/variables as URL
// search params, so matching on the full URL would miss every GET request.
const normalizeURL = (url: string): EndpointURL => {
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname}`
}

const parseGraphQLQuery = async (request: Request): Promise<string> => {
  if (request.method === 'GET') {
    return new URL(request.url).searchParams.get('query') ?? ''
  }

  try {
    const body = await request.json() as { query?: string }
    return body.query ?? ''
  } catch {
    return ''
  }
}

const resolveSpecification = (specification: Specification): Resolution =>
  specification.kind === 'networkError'
    ? { kind: 'networkError' }
    : { kind: 'response', status: specification.status, body: specification.body }

const resolveRequest = async (request: Request): Promise<Resolution> => {
  const endpoint = registry.get(normalizeURL(request.url))
  if (!endpoint) return { kind: 'passthrough' }

  if (endpoint.schema) {
    const query = await parseGraphQLQuery(request)
    const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/)
    const operationName = match?.[1]

    if (!operationName) return { kind: 'passthrough' }

    const specification = endpoint.specifications.get(operationName)
    if (!specification || specification.remaining <= 0) return { kind: 'passthrough' }

    specification.remaining -= 1

    const graphqlContext = { operationName, url: endpoint.url, method: request.method, query }

    if (reporter) {
      await reporter.report(graphqlContext)
    }

    if (process.env['WHURL_VERBOSE'] === 'true') {
      console.log(formatHurlRequest(graphqlContext))
    }

    return resolveSpecification(specification)
  }

  const method = request.method.toUpperCase()
  const specification = endpoint.specifications.get(method)
  if (!specification || specification.remaining <= 0) return { kind: 'passthrough' }

  specification.remaining -= 1

  const restContext = { operationName: specification.operationName ?? method, url: endpoint.url, method, query: '' }

  if (reporter) {
    await reporter.report(restContext)
  }

  if (process.env['WHURL_VERBOSE'] === 'true') {
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
  const restEndpoints = [...registry.values()].filter(e => e.schema === undefined)
  if (restEndpoints.length === 0) {
    throw new Error('No plain endpoint registered. Call register first.')
  }
  if (restEndpoints.length > 1) {
    throw new Error('Multiple plain endpoints registered. Specify a URL as the second argument.')
  }
  return restEndpoints[0]!
}

const findGraphQLEndpoint = (): Endpoint => {
  const graphqlEndpoints = [...registry.values()].filter(e => e.schema !== undefined)
  if (graphqlEndpoints.length === 0) {
    throw new Error('No GraphQL endpoint registered. Call registerWithSchema first.')
  }
  if (graphqlEndpoints.length > 1) {
    throw new Error('Multiple GraphQL endpoints registered. Use the three-argument form to specify a URL.')
  }
  return graphqlEndpoints[0]!
}

const validateSpecificationData = (operationName: string, data: SpecifyData, schema: GraphQLSchema): void => {
  const keys = Object.keys(data)
  if (keys.length !== 1) {
    throw new Error(
      `Expected response data for '${operationName}' to have exactly one top-level key (the field name), got: ${keys.join(', ') || '(none)'}`
    )
  }
  const fieldName = keys[0]!

  const queryType = schema.getQueryType()
  const mutationType = schema.getMutationType()
  const field = queryType?.getFields()[fieldName] ?? mutationType?.getFields()[fieldName]

  if (!field) {
    throw new Error(`No query or mutation field named '${fieldName}' found in schema (from specify('${operationName}', ...))`)
  }

  const namedType = getNamedType(field.type)
  const responseValue = data[fieldName]

  if (isObjectType(namedType) && typeof responseValue === 'object' && responseValue !== null && !Array.isArray(responseValue)) {
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
  registry.set(key, { url, specifications: new Map() })
}

export const registerWithSchema: RegisterWithSchemaFn = (url: EndpointURL, schemaString: string): void => {
  validateURL(url)
  const key = normalizeURL(url)
  if (registry.has(key)) {
    throw new Error(`Endpoint already registered: ${url}`)
  }
  const schema = buildSchema(schemaString)
  registry.set(key, { url, schema, specifications: new Map() })
}

// A plain (no leading status) call wraps its body in a { data } envelope and
// is validated against the schema, matching a plain successful response. A
// leading status hands the body over as-is, unwrapped and unvalidated, since
// it can describe any shape, an errors array, a REST error body, or a
// deliberately malformed string.
//
// Dispatch is by argument count, not by the type of the second argument.
// That worked before a body could only ever be an object (never a string),
// so "is the second argument a string" doubled as "is this the REST form."
// A malformed-body GraphQL call now puts a string in that same slot, so
// count is the only thing left that reliably tells the forms apart.
export const specify: SpecifyFn = (...args: unknown[]): SpecificationHandle => {
  const status = typeof args[0] === 'number' ? (args.shift() as number) : undefined

  const toResponse = (body: SpecifyBody): { status: number; body: unknown } =>
    status === undefined ? { status: 200, body: { data: body } } : { status, body }

  if (args.length === 2) {
    const [operationName, specBody] = args as [string, SpecifyBody]
    const endpoint = findGraphQLEndpoint()

    if (status === undefined && endpoint.schema) {
      validateSpecificationData(operationName, specBody as SpecifyData, endpoint.schema)
    }

    const specification: Specification = { kind: 'response', operationName, ...toResponse(specBody), remaining: 1 }
    endpoint.specifications.set(operationName, specification)
    return { repeat: (n: number) => { specification.remaining = n } }
  }

  if (args.length === 3) {
    const [operationName, method, specBody] = args as [string, string, SpecifyBody]
    const endpoint = findRestEndpoint()
    const specification: Specification = { kind: 'response', operationName, method: method.toUpperCase(), ...toResponse(specBody), remaining: 1 }
    endpoint.specifications.set(method.toUpperCase(), specification)
    return { repeat: (n: number) => { specification.remaining = n } }
  }

  const [operationName, url, method, specBody] = args as [string, string, string, SpecifyBody]
  const endpoint = registry.get(normalizeURL(url))
  if (!endpoint) throw new Error(`No endpoint registered for URL: ${url}`)
  const specification: Specification = { kind: 'response', operationName, method: method.toUpperCase(), ...toResponse(specBody), remaining: 1 }
  endpoint.specifications.set(method.toUpperCase(), specification)
  return { repeat: (n: number) => { specification.remaining = n } }
}

export const specifyNetworkError: SpecifyNetworkErrorFn = (operationName: string): SpecificationHandle => {
  const endpoint = findGraphQLEndpoint()
  const specification: Specification = { kind: 'networkError', operationName, remaining: 1 }
  endpoint.specifications.set(operationName, specification)
  return { repeat: (n: number) => { specification.remaining = n } }
}
