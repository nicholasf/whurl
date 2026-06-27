import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReportContext } from '../../src/types.js'

const graphqlContext: ReportContext = {
  operationName: 'Me',
  url: 'http://localhost:3000/graphql',
  method: 'POST',
  query: 'query Me { me { id name email } }',
}

const restContext: ReportContext = {
  operationName: 'GetAccount',
  url: 'http://localhost:3000/api/accounts',
  method: 'GET',
  query: '',
}

describe('formatHurlRequest', () => {
  it('produces a POST with Content-Type header and JSON body for a GraphQL request', async () => {
    const { formatHurlRequest } = await import('../../src/reporters/hurl.js')

    expect(formatHurlRequest(graphqlContext)).toBe(
      `POST http://localhost:3000/graphql\nContent-Type: application/json\n\n${JSON.stringify({ query: 'query Me { me { id name email } }' }, null, 2)}`
    )
  })

  it('produces just METHOD URL for a plain HTTP request with no query', async () => {
    const { formatHurlRequest } = await import('../../src/reporters/hurl.js')

    expect(formatHurlRequest(restContext)).toBe('GET http://localhost:3000/api/accounts')
  })
})

describe('createHurlReporter', () => {
  let mockMkdir: ReturnType<typeof vi.fn>
  let mockWriteFile: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-26T08:00:00.000Z'))
    vi.resetModules()

    mockMkdir = vi.fn().mockResolvedValue(undefined)
    mockWriteFile = vi.fn().mockResolvedValue(undefined)

    vi.doMock('node:fs/promises', () => ({
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('creates the whurl output directory', async () => {
    const { createHurlReporter } = await import('../../src/reporters/hurl.js')
    const reporter = createHurlReporter()
    await reporter.report(graphqlContext)

    expect(mockMkdir).toHaveBeenCalledWith('whurl', { recursive: true })
  })

  it('writes a file named with timestamp and operation name', async () => {
    const { createHurlReporter } = await import('../../src/reporters/hurl.js')
    const reporter = createHurlReporter()
    await reporter.report(graphqlContext)

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringMatching(/Me\.hurl$/),
      expect.any(String),
      'utf-8'
    )
  })

  it('writes the Hurl-formatted request as file content', async () => {
    const { createHurlReporter, formatHurlRequest } = await import('../../src/reporters/hurl.js')
    const reporter = createHurlReporter()
    await reporter.report(graphqlContext)

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      formatHurlRequest(graphqlContext),
      'utf-8'
    )
  })

  it('writes just METHOD URL for a plain HTTP request', async () => {
    const { createHurlReporter } = await import('../../src/reporters/hurl.js')
    const reporter = createHurlReporter()
    await reporter.report(restContext)

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      'GET http://localhost:3000/api/accounts',
      'utf-8'
    )
  })
})
