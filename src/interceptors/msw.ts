import { setupServer } from 'msw/node'
import { http, HttpResponse, passthrough, type JsonBodyType } from 'msw'
import type { Interceptor, Resolution } from '../types.js'

type RequestResolver = (request: Request) => Promise<Resolution>

export const createMSWInterceptor = (resolve: RequestResolver): Interceptor => {
  const server = setupServer(
    http.all('*', async ({ request }) => {
      const resolution = await resolve(request)

      if (resolution.kind === 'passthrough') return passthrough()
      if (resolution.kind === 'networkError') return HttpResponse.error()

      const { status, body } = resolution
      return typeof body === 'string'
        ? new HttpResponse(body, { status })
        : HttpResponse.json(body as JsonBodyType, { status })
    })
  )

  return {
    start: () => server.listen({ onUnhandledRequest: 'bypass' }),
    stop: () => server.close(),
    reset: () => server.resetHandlers(),
  }
}
