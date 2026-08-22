/**
 * Grok quota provider。
 *
 * 主采集:GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
 * - Authorization: Bearer <~/.grok/auth.json 的 key>(OIDC JWT,6h 时效,CLI 自动刷新回写)
 * - X-XAI-Token-Auth: xai-grok-cli(固定路由标识常量,不是 token)
 * 每次请求前重读 auth.json;401 时不自行 refresh(rotation 冲突风险),提示用户开一次 Grok CLI。
 *
 * subscriptionTier(SuperGrok 等)不在 billing 响应里(CLI 从 RemoteSettings 合并),
 * 从本地日志 unified.jsonl 尾部扫描兜底。日志 quota 快照不做降级数据源:
 * 它只在会话期间更新,非会话期数据可能严重过期,展示出来会误导。
 *
 * 详见 docs/quota-research-grok.md(认证方式已对照官方开源 grok-build 的 billing.rs)。
 */
import { readFileSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { asNumber, asRecord, asString, getJson } from './http'
import type { QuotaCredential, QuotaWindow } from './types'

const AUTH_PATH = join(homedir(), '.grok', 'auth.json')
const LOG_PATH = join(homedir(), '.grok', 'logs', 'unified.jsonl')
const BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
const TOKEN_AUTH_HEADER = 'xai-grok-cli'
const REQUEST_TIMEOUT_MS = 15_000
const LOG_TAIL_BYTES = 512 * 1024

interface GrokCredentials {
  key: string
  userId: string | null
}

/** auth.json 的键是 `https://auth.x.ai::<client_id>`,取第一个带 key 的条目 */
function readCredentials(): GrokCredentials | null {
  try {
    const raw = asRecord(JSON.parse(readFileSync(AUTH_PATH, 'utf-8')))
    if (!raw) return null
    for (const value of Object.values(raw)) {
      const entry = asRecord(value)
      const key = asString(entry?.key)
      if (key) return { key, userId: asString(entry?.user_id) }
    }
    return null
  } catch {
    return null
  }
}

function periodLabel(type: string | null): { key: string; label: string } {
  if (type?.includes('WEEKLY')) return { key: 'weekly', label: 'Weekly' }
  if (type?.includes('MONTHLY')) return { key: 'monthly', label: 'Monthly' }
  if (type?.includes('DAILY')) return { key: 'daily', label: 'Daily' }
  return { key: 'credits', label: 'Credits' }
}

/** 纯解析,单测覆盖;proto3 JSON 的 0 值字段会省略为 {},一律容错 */
export function parseGrokBilling(json: unknown): {
  windows: QuotaWindow[]
  extras: Array<{ label: string; value: string }>
} {
  const config = asRecord(asRecord(json)?.config)
  if (!config) return { windows: [], extras: [] }

  const windows: QuotaWindow[] = []
  const percent = asNumber(config.creditUsagePercent)
  const period = asRecord(config.currentPeriod)
  if (percent !== null) {
    const { key, label } = periodLabel(asString(period?.type))
    windows.push({
      key,
      label,
      usedPercent: Math.min(100, Math.max(0, percent)),
      resetsAt: asString(period?.end) ?? asString(config.billingPeriodEnd)
    })
  }

  const extras: Array<{ label: string; value: string }> = []
  // 分产品用量(周池跨产品共享,展示占比非零的)
  if (Array.isArray(config.productUsage)) {
    for (const item of config.productUsage) {
      const rec = asRecord(item)
      const product = asString(rec?.product)
      const usage = asNumber(rec?.usagePercent)
      if (product && usage !== null && usage > 0) {
        extras.push({ label: product, value: `${Math.round(usage)}%` })
      }
    }
  }
  // Extra Credits 余额(美分);为 0 时 proto3 省略为 {}
  const prepaidCents = asNumber(asRecord(config.prepaidBalance)?.val)
  if (prepaidCents !== null && prepaidCents > 0) {
    extras.push({ label: 'Extra credits', value: `$${(prepaidCents / 100).toFixed(2)}` })
  }
  return { windows, extras }
}

/** 从日志尾部扫描最近一次订阅层级(日志可能很大,只读末尾 512KB) */
function readSubscriptionTier(): string | null {
  try {
    if (!existsSync(LOG_PATH)) return null
    const size = statSync(LOG_PATH).size
    const fd = openSync(LOG_PATH, 'r')
    try {
      const start = Math.max(0, size - LOG_TAIL_BYTES)
      const buf = Buffer.alloc(size - start)
      readSync(fd, buf, 0, buf.length, start)
      const tail = buf.toString('utf-8')
      const matches = [...tail.matchAll(/"subscriptionTier"\s*:\s*"([^"]+)"/g)]
      return matches.length > 0 ? matches[matches.length - 1][1] : null
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

export function grokCredentialExists(): boolean {
  return readCredentials() !== null
}

/**
 * @param cred local = 读 ~/.grok/auth.json;manual = 用户粘贴的 key。
 *   注意 key 是 6h 时效的 JWT,manual 场景过期后需要重新粘贴(UI 会提示)。
 */
export async function collectGrokQuota(cred: QuotaCredential): Promise<{
  windows: QuotaWindow[]
  extras: Array<{ label: string; value: string }>
  plan: string | null
}> {
  const creds =
    cred.source === 'manual' ? { key: cred.token, userId: null } : readCredentials()
  if (!creds) throw new Error('No Grok credentials found')
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.key}`,
    'X-XAI-Token-Auth': TOKEN_AUTH_HEADER
  }
  if (creds.userId) headers['x-userid'] = creds.userId
  const json = await getJson(BILLING_URL, headers, REQUEST_TIMEOUT_MS)
  const parsed = parseGrokBilling(json)
  if (parsed.windows.length === 0) throw new Error('Unexpected billing response shape')
  // 订阅档位只存在于本机日志;manual 账号(可能在别的机器)拿不到
  return { ...parsed, plan: cred.source === 'local' ? readSubscriptionTier() : null }
}
