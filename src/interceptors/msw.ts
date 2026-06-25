import { setupServer } from 'msw/node'
import { http, HttpResponse, passthrough } from 'msw'
import type { Interceptor, SpecifyData } from '../types.js'

type RequestResolver = (request: Request) => Promise<SpecifyData | null>

export const createMSWInterceptor = (resolve: RequestResolver): Interceptor => {
  const server = setupServer(
    http.all('*', async ({ request }) => {
      const data = await resolve(request)
      if (data === null) return passthrough()
      return HttpResponse.json({ data })
    })
  )

  return {
    start: () => server.listen({ onUnhandledRequest: 'bypass' }),
    stop: () => server.close(),
    reset: () => server.resetHandlers(),
  }
}
