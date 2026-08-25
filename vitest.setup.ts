/**
 * Unit tests run in Node, not Electron. Importing real `electron` downloads
 * the Chromium binary on first load and can blow the default 5s timeout on CI.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => join(tmpdir(), 'coding-usage-dashboard-test', name)
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (buf: Buffer) => buf.toString('utf8')
  }
}))
