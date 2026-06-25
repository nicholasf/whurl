import { beforeAll, afterAll } from 'vitest'
import { start, stop } from './index.js'

beforeAll(() => start())
afterAll(() => stop())
