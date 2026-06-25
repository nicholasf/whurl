import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Reporter, ReportContext } from '../types.js'

const outputDirectory = 'whurl'

export const formatHurlRequest = (context: ReportContext): string => {
  if (context.query) {
    return [
      `${context.method} ${context.url}`,
      'Content-Type: application/json',
      '',
      JSON.stringify({ query: context.query }, null, 2),
    ].join('\n')
  }
  return `${context.method} ${context.url}`
}

export const createHurlReporter = (): Reporter => ({
  report: async (context: ReportContext): Promise<void> => {
    await mkdir(outputDirectory, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1)
    const filename = `${timestamp}-${context.operationName}.hurl`

    await writeFile(join(outputDirectory, filename), formatHurlRequest(context), 'utf-8')
  },
})
