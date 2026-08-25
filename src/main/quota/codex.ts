/**
 * ChatGPT(Codex)quota provider。
 *
 * 主采集:GET https://chatgpt.com/backend-api/wham/usage,
 * 凭据读自 ~/.codex/auth.json 的 tokens.access_token(+ account_id 头,实测可选)。
 * access_token 约 10 天有效期,由 Codex CLI 自动刷新;我们每次请求前重读文件,
 * 绝不自行实现 OAuth refresh。401 时提示用户跑一次任意 codex 命令续期。
 *
 * 窗口按 limit_window_seconds 动态渲染(Plus 账号可能只有周窗口,无 5h)。
 * 详见 docs/quota-research-gpt.md。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { asNumber, asRecord, asString, getJson, unixSecondsToIso, windowKeyAndLabel } from './http'
import type { QuotaCredential, QuotaWindow } from './types'

const AUTH_PATH = join(homedir(), '.codex', 'auth.json')
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const REQUEST_TIMEOUT_MS = 15_000

interface CodexCredentials {
  accessToken: string
  accountId: string | null
}

function readCredentials(): CodexCredentials | null {
  try {
    const raw = asRecord(JSON.parse(readFileSync(AUTH_PATH, 'utf-8')))
    const tokens = asRecord(raw?.tokens)
    const accessToken = asString(tokens?.access_token)
    if (!accessToken) return null
    return { accessToken, accountId: asString(tokens?.account_id) }
  } catch {
    return null
  }
}

function parseWindow(node: unknown): QuotaWindow | null {
  const rec = asRecord(node)
  if (!rec) return null
  const usedPercent = asNumber(rec.used_percent)
  if (usedPercent === null) return null
  const seconds = asNumber(rec.limit_window_seconds)
  const { key, label } = windowKeyAndLabel(seconds)
  return {
    key,
    label,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetsAt: unixSecondsToIso(rec.reset_at)
  }
}

/** 纯解析,单测覆盖;字段缺失一律降级 */
export function parseWhamUsage(json: unknown): {
  plan: string | null
  windows: QuotaWindow[]
  extras: Array<{ label: string; value: string }>
} {
  const root = asRecord(json)
  const plan = asString(root?.plan_type)
  const rateLimit = asRecord(root?.rate_limit)

  const windows: QuotaWindow[] = []
  for (const key of ['primary_window', 'secondary_window'] as const) {
    const win = parseWindow(rateLimit?.[key])
    if (win && !windows.some((w) => w.key === win.key)) windows.push(win)
  }

  const extras: Array<{ label: string; value: string }> = []
  const credits = asRecord(root?.credits)
  const balance = asNumber(credits?.balance)
  if (credits?.has_credits === true && balance !== null) {
    extras.push({ label: 'Credits', value: `$${balance.toFixed(2)}` })
  }
  return { plan, windows, extras }
}

export function codexCredentialExists(): boolean {
  return readCredentials() !== null
}

/**
 * @param cred local = 读 ~/.codex/auth.json;manual = 用户粘贴的 access_token
 *   (account_id 头实测可选,manual 场景没有它,仅响应里 account_id 字段为空)
 */
export async function collectCodexQuota(cred: QuotaCredential): Promise<{
  plan: string | null
  windows: QuotaWindow[]
  extras: Array<{ label: string; value: string }>
  remoteUserId: string | null
}> {
  const creds =
    cred.source === 'manual'
      ? { accessToken: cred.token, accountId: null }
      : readCredentials()
  if (!creds) throw new Error('No Codex credentials found')
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.accessToken}`,
    // 模拟官方 CLI,降低 Cloudflare 拦截概率
    'User-Agent': 'codex_cli_rs'
  }
  if (creds.accountId) headers['ChatGPT-Account-Id'] = creds.accountId
  const json = await getJson(USAGE_URL, headers, REQUEST_TIMEOUT_MS)
  // local 的 account_id 即远端账号身份;manual 场景没有它
  return { ...parseWhamUsage(json), remoteUserId: cred.source === 'local' ? creds.accountId : null }
}
