// whurl — GraphQL test double and contract layer
import { buildSchema, getNamedType, isObjectType, type GraphQLSchema } from 'graphql'
import { createMSWInterceptor } from './interceptors/msw.js'
import { createHurlReporter, formatHurlRequest } from './reporters/hurl.js'
import type { Endpoint, EndpointURL, RegisterFn, RegisterWithSchemaFn, Reporter, SpecificationHandle, SpecifyFn, SpecifyData } from './types.js'

const registry = new Map<EndpointURL, Endpoint>()

const reporter: Reporter | null = process.env['WHURL'] === 'true'
  ? createHurlReporter()
  : null

const resolveRequest = async (request: Request): Promise<SpecifyData | null> => {
  const endpoint = registry.get(request.url)
  if (!endpoint) return null

  if (endpoint.schema) {
    let body: { query?: string }
    try {
      body = await request.json() as { query?: string }
    } catch {
      return null
    }

    const query = body.query ?? ''
    const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/)
    const operationName = match?.[1]

    if (!operationName) return null

    const specification = endpoint.specifications.get(operationName)
    if (!specification || specification.remaining <= 0) return null

    specification.remaining -= 1

    const graphqlContext = { operationName, url: endpoint.url, method: request.method, query }

    if (reporter) {
      await reporter.report(graphqlContext)
    }

    if (process.env['WHURL_VERBOSE'] === 'true') {
      console.log(formatHurlRequest(graphqlContext))
    }

    return specification.data
  }

  const method = request.method.toUpperCase()
  const specification = endpoint.specifications.get(method)
  if (!specification || specification.remaining <= 0) return null

  specification.remaining -= 1

  const restContext = { operationName: specification.operationName ?? method, url: endpoint.url, method, query: '' }

  if (reporter) {
    await reporter.report(restContext)
  }

  if (process.env['WHURL_VERBOSE'] === 'true') {
    console.log(formatHurlRequest(restContext))
  }

  return specification.data
}

const interceptor = createMSWInterceptor(resolveRequest)

export const start = (): void => interceptor.start()
export const stop = (): void => interceptor.stop()

export const reset = (): void => {
  registry.clear()
}

export const _getEndpoint = (url: EndpointURL): Endpoint => {
  const endpoint = registry.get(url)
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
  const fieldName = operationName.charAt(0).toLowerCase() + operationName.slice(1)

  const queryType = schema.getQueryType()
  const mutationType = schema.getMutationType()
  const field = queryType?.getFields()[fieldName] ?? mutationType?.getFields()[fieldName]

  if (!field) {
    throw new Error(`No query or mutation named '${fieldName}' found in schema`)
  }

  if (!(fieldName in data)) {
    throw new Error(`Expected response data to have key '${fieldName}'`)
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
  if (registry.has(url)) {
    throw new Error(`Endpoint already registered: ${url}`)
  }
  registry.set(url, { url, specifications: new Map() })
}

export const registerWithSchema: RegisterWithSchemaFn = (url: EndpointURL, schemaString: string): void => {
  validateURL(url)
  if (registry.has(url)) {
    throw new Error(`Endpoint already registered: ${url}`)
  }
  const schema = buildSchema(schemaString)
  registry.set(url, { url, schema, specifications: new Map() })
}

export const specify: SpecifyFn = (
  operationName: string,
  dataOrMethodOrUrl: SpecifyData | string,
  methodOrData?: SpecifyData | string,
  _data?: SpecifyData
): SpecificationHandle => {
  if (typeof dataOrMethodOrUrl !== 'string') {
    const specData = dataOrMethodOrUrl
    const endpoint = findGraphQLEndpoint()

    if (endpoint.schema) {
      validateSpecificationData(operationName, specData, endpoint.schema)
    }

    const specification = { operationName, data: specData, remaining: 1 }
    endpoint.specifications.set(operationName, specification)

    return { repeat: (n: number) => { specification.remaining = n } }
  }

  if (typeof methodOrData === 'string') {
    const url = dataOrMethodOrUrl
    const method = methodOrData.toUpperCase()
    const specData = _data!
    const endpoint = registry.get(url)
    if (!endpoint) throw new Error(`No endpoint registered for URL: ${url}`)
    const specification = { operationName, method, data: specData, remaining: 1 }
    endpoint.specifications.set(method, specification)
    return { repeat: (n: number) => { specification.remaining = n } }
  }

  const method = dataOrMethodOrUrl.toUpperCase()
  const specData = methodOrData!
  const endpoint = findRestEndpoint()
  const specification = { operationName, method, data: specData, remaining: 1 }
  endpoint.specifications.set(method, specification)
  return { repeat: (n: number) => { specification.remaining = n } }
}
