import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Reporter, ReportContext } from '../types.js'

const outputDirectory = 'whurl'

export const createHurlReporter = (): Reporter => ({
  report: async (context: ReportContext): Promise<void> => {
    await mkdir(outputDirectory, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1)
    const filename = `${timestamp}-${context.operationName}.hurl`

    const content = [
      `${context.method} ${context.url}`,
      'Content-Type: application/json',
      '',
      JSON.stringify({ query: context.query }, null, 2),
    ].join('\n')

    await writeFile(join(outputDirectory, filename), content, 'utf-8')
  },
})
