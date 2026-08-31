/**
 * Cursor 官方用量接口封装。
 *
 * 端点(2026-08-31 实测,对照社区实现 TokenTracker / CodexBar):
 * - GET https://cursor.com/api/usage-summary            当前周期额度 JSON
 * - GET https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens
 *   逐事件用量 CSV(Date, Model, Input/Cache Read/Output/Total Tokens, Cost)
 * 认证:cookie `WorkosCursorSessionToken=<userId>%3A%3A<jwt>`,见 auth.ts。
 * 注意:cookie 只对裸域 cursor.com 生效,www.cursor.com 直接 401;redirect 交给 fetch
 * 处理,若将来端点开始跳 www 会降级为 401 → fail-soft,不会崩。
 *
 * 为什么用 Node 全局 fetch 而不是 shared 的 net.fetch:Chromium 把 Cookie 列为
 * forbidden header,Electron 的 net.fetch / net.request 都会直接 ERR_BLOCKED_BY_CLIENT
 * (2026-08-31 实测)。Node 全局 fetch(undici)允许设置 Cookie,且已在 Electron 主进程
 * 内实测 200。代价:undici 不读 Windows 系统代理;需要代理才能访问 cursor.com 的
 * 环境会降级为 skipped(见 docs/quota-research-cursor.md 的已知限制)。
 */
import { QuotaHttpError } from '../quota/http'
import { cursorSessionCookie } from './auth'
import type { CursorAuth } from './auth'

const USAGE_SUMMARY_URL = 'https://cursor.com/api/usage-summary'
const USAGE_CSV_URL = 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens'
const REQUEST_TIMEOUT_MS = 15_000

async function cursorFetch(url: string, auth: CursorAuth): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        Cookie: cursorSessionCookie(auth),
        Referer: 'https://www.cursor.com/settings',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    })
    if (!res.ok) throw new QuotaHttpError(res.status, `Cursor API returned ${res.status}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

/** 当前周期额度摘要;401 说明 token 过期(开一次 Cursor 让它刷新) */
export async function fetchCursorUsageSummary(auth: CursorAuth): Promise<unknown> {
  const res = await cursorFetch(USAGE_SUMMARY_URL, auth)
  return (await res.json()) as unknown
}

/** 逐事件用量 CSV(覆盖全部历史事件);非 2xx 抛 QuotaHttpError */
export async function fetchCursorUsageCsv(auth: CursorAuth): Promise<string> {
  const res = await cursorFetch(USAGE_CSV_URL, auth)
  return res.text()
}

/** 把抓取/解析异常归成 Settings 状态行可展示的短句 */
export function toCursorApiError(err: unknown): string {
  if (err instanceof QuotaHttpError) {
    if (err.status === 401) return 'Cursor session expired — open Cursor once to refresh'
    return `Cursor API returned HTTP ${err.status}`
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Cursor API request timed out'
    if (err.message === 'fetch failed') return 'Cursor API unreachable (network/proxy)'
    return err.message.slice(0, 120)
  }
  return 'Unknown Cursor API error'
}
