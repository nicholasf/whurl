// whurl — GraphQL test double and contract layer
import { buildSchema, getNamedType, isObjectType, type GraphQLSchema } from 'graphql'
import { createMSWInterceptor } from './interceptors/msw.js'
import { createHurlReporter } from './reporters/hurl.js'
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

    if (reporter) {
      await reporter.report({
        operationName,
        url: endpoint.url,
        method: request.method,
        query,
      })
    }

    return specification.data
  }

  return null
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
  dataOrVerbOrUrl: SpecifyData | string,
  _data?: SpecifyData
): SpecificationHandle => {
  if (typeof dataOrVerbOrUrl === 'string') {
    // three-argument form: operationName, verbOrUrl, data — to be implemented
    return { repeat: (_n: number) => {} }
  } else {
    const specData = dataOrVerbOrUrl
    const endpoint = findGraphQLEndpoint()

    if (endpoint.schema) {
      validateSpecificationData(operationName, specData, endpoint.schema)
    }

    const specification = { operationName, data: specData, remaining: 1 }
    endpoint.specifications.set(operationName, specification)

    return { repeat: (n: number) => { specification.remaining = n } }
  }
}
