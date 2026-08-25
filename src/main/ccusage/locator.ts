import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runCcusage } from './runner'
import type { DetectResult } from '../../shared/usage-model'

const execFileAsync = promisify(execFile)

const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/

/**
 * 只负责定位本机已安装的 ccusage:where.exe 找路径,--version 读版本。
 * 找不到就返回 found:false,绝不触发任何安装/下载行为。
 */
export async function locateCcusage(): Promise<DetectResult> {
  const paths = await whereCcusage()
  if (paths.length === 0) {
    return { found: false }
  }
  // Windows npm/Volta shim:优先 .cmd,其次无扩展名 shim,其余原样
  const preferred =
    paths.find((p) => p.toLowerCase().endsWith('.cmd')) ??
    paths.find((p) => !/\.[a-z0-9]+$/i.test(p)) ??
    paths[0]

  const version = await readVersion(preferred)
  if (!version) {
    return { found: false }
  }
  return { found: true, path: preferred, version }
}

async function whereCcusage(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('where.exe', ['ccusage'], {
      timeout: 10_000,
      windowsHide: true
    })
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

async function readVersion(ccusagePath: string): Promise<string | null> {
  try {
    const stdout = await runCcusage(ccusagePath, ['--version'], 15_000)
    const match = stdout.match(VERSION_PATTERN)
    return match ? match[1] : null
  } catch {
    return null
  }
}
