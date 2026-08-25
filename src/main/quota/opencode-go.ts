/**
 * OpenCode Go quota provider。
 *
 * GET https://opencode.ai/zen/go/v1/usage,Bearer key 读自
 * %USERPROFILE%\.local\share\opencode\auth.json 的 opencode-go.key。
 * 注意:同目录 account.json 里的 key 可能未绑定订阅(实测 403),只认 auth.json。
 * 主机必须固定 opencode.ai(api.opencode.ai 会返回 200 + "Not Found" 兜底文本)。
 *
 * 额度单位是美元(5h $12 / 周 $30 / 月 $60),API 只给整数百分比,不给绝对金额;
 * 文档明示限额可能调整,因此 UI 以百分比为主,不展示美元估计。
 * 详见 docs/quota-research-opencode-go.md。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { asNumber, asRecord, asString, getJson } from './http'
import type { QuotaCredential, QuotaWindow } from './types'

const AUTH_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const REQUEST_TIMEOUT_MS = 15_000

function readApiKey(): string | null {
  try {
    const raw = asRecord(JSON.parse(readFileSync(AUTH_PATH, 'utf-8')))
    const entry = asRecord(raw?.['opencode-go'])
    return asString(entry?.key)
  } catch {
    return null
  }
}

const WINDOW_DEFS = [
  { field: 'rolling', key: '5h', label: '5h' },
  { field: 'weekly', key: 'weekly', label: 'Weekly' },
  { field: 'monthly', key: 'monthly', label: 'Monthly' }
] as const

/** 纯解析,单测覆盖;status 非 "ok" 视为受限(按 percent 原样展示) */
export function parseOpencodeGoUsage(json: unknown): { windows: QuotaWindow[] } {
  const usage = asRecord(asRecord(json)?.usage)
  if (!usage) return { windows: [] }
  const windows: QuotaWindow[] = []
  for (const def of WINDOW_DEFS) {
    const node = asRecord(usage[def.field])
    if (!node) continue
    const percent = asNumber(node.percent)
    if (percent === null) continue
    windows.push({
      key: def.key,
      label: def.label,
      usedPercent: Math.min(100, Math.max(0, percent)),
      resetsAt: asString(node.resetsAt)
    })
  }
  return { windows }
}

export function opencodeGoCredentialExists(): boolean {
  return readApiKey() !== null
}

/** @param cred local = 读 auth.json 的 opencode-go.key;manual = 用户粘贴的 API key */
export async function collectOpencodeGoQuota(cred: QuotaCredential): Promise<{ windows: QuotaWindow[] }> {
  const key = cred.source === 'manual' ? cred.token : readApiKey()
  if (!key) throw new Error('No OpenCode Go key found')
  const json = await getJson(USAGE_URL, { Authorization: `Bearer ${key}` }, REQUEST_TIMEOUT_MS)
  const parsed = parseOpencodeGoUsage(json)
  if (parsed.windows.length === 0) throw new Error('Unexpected usage response shape')
  return parsed
}
