/** quota 采集共用的 HTTP 小工具:超时控制 + 非 2xx 归类。只在主进程使用。 */

export class QuotaHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'QuotaHttpError'
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * 优先用 Electron net.fetch(Chromium 网络栈,自动遵循 Windows 系统代理——
 * chatgpt.com 在这台机器上必须走代理);vitest / 纯 Node 环境退回全局 fetch。
 * 结果缓存,import('electron') 在 Node 下解析出二进制路径字符串,net 为 undefined。
 */
let cachedFetch: FetchLike | null = null
export async function resolveFetch(): Promise<FetchLike> {
  if (cachedFetch) return cachedFetch
  try {
    const mod = (await import('electron')) as { net?: { fetch?: FetchLike } }
    if (mod.net && typeof mod.net.fetch === 'function') {
      cachedFetch = (url, init) => mod.net!.fetch!(url, init)
      return cachedFetch
    }
  } catch {
    // 非 Electron 环境
  }
  cachedFetch = (url, init) => fetch(url, init)
  return cachedFetch
}

/** GET JSON,带超时;非 2xx 抛 QuotaHttpError。headers 由调用方给(含凭据),绝不打日志 */
export async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  const doFetch = await resolveFetch()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await doFetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal
    })
    if (!res.ok) throw new QuotaHttpError(res.status, `HTTP ${res.status}`)
    return (await res.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

/** 把任意异常转成可展示的短句(不含 URL、header、凭据) */
export function toDisplayError(err: unknown): string {
  if (err instanceof QuotaHttpError) {
    if (err.status === 401) return 'Unauthorized — credential expired'
    if (err.status === 403) return 'Forbidden — subscription or permission issue'
    if (err.status === 429) return 'Rate limited by server'
    return `HTTP ${err.status}`
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Request timed out'
    // undici 网络层失败统一是 "fetch failed"(DNS/连接超时/被重置)
    if (err.message === 'fetch failed') return 'Network unreachable — check proxy/VPN'
    return err.message.slice(0, 120)
  }
  return 'Unknown error'
}

/** 宽松读取:number 或数字字符串都接受,其他为 null */
export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

export function asString(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

/** unix 秒 → ISO 字符串;非法输入为 null */
export function unixSecondsToIso(v: unknown): string | null {
  const n = asNumber(v)
  if (n === null || n <= 0) return null
  return new Date(n * 1000).toISOString()
}

/** 窗口秒数 → 稳定 key 与展示标签(18000→5h,604800→Weekly,其他动态生成) */
export function windowKeyAndLabel(seconds: number | null): { key: string; label: string } {
  if (seconds === null || seconds <= 0) return { key: 'unknown', label: 'Window' }
  if (Math.abs(seconds - 5 * 3600) <= 600) return { key: '5h', label: '5h' }
  if (Math.abs(seconds - 7 * 86400) <= 3600) return { key: 'weekly', label: 'Weekly' }
  if (seconds % 86400 === 0) {
    const days = seconds / 86400
    return { key: `${days}d`, label: days === 1 ? 'Daily' : `${days}d` }
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600
    return { key: `${hours}h`, label: `${hours}h` }
  }
  const mins = Math.round(seconds / 60)
  return { key: `${mins}m`, label: `${mins}m` }
}
