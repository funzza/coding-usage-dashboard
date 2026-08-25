/**
 * Kimi quota provider。
 *
 * 首选链路(官方文档化):`kimi web` 本地服务的 GET /api/v1/oauth/usage,
 * Bearer 即 ~/.kimi-code/server.token,access_token 刷新由 CLI 自己处理。
 * 先扫描 58627–58727 上已有实例(healthz 免鉴权),没有则以 --no-open 拉起
 * sidecar(应用退出时只杀自己拉起的实例)。
 *
 * 降级链路:本地服务不可用时,读 credentials/kimi-code.json 的 access_token
 * 直连云端 /coding/v1/usages——仅在 token 未过期时使用,绝不自行刷新
 * refresh_token(rotation 冲突会把 CLI 登出)。
 *
 * 详见 docs/quota-research-kimi.md。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getWslHomeUncPath, getWslIpAddress } from '../wsl/home'
import { asNumber, asRecord, asString, getJson } from './http'
import type { UsageOrigin } from '../../shared/agents'
import type { QuotaWindow } from './types'

const KIMI_DIR = join(homedir(), '.kimi-code')
const PORT_MIN = 58627
const PORT_MAX = 58727
const HEALTH_TIMEOUT_MS = 400
const REQUEST_TIMEOUT_MS = 10_000
const SIDECAR_BOOT_TIMEOUT_MS = 10_000

/**
 * kimi 运行环境(Windows 本机 / WSL)。两侧的采集链路同构:
 * 探测已有 web 实例 → 本地 API;未命中降级读凭据直连云端。
 * 差异仅在路径与探测主机:WSL 凭据经 UNC 直读,实例经 WSL IP/localhost 探测,
 * 且不 spawn sidecar(Linux 进程不纳管)。
 */
interface KimiEnv {
  serverTokenPath: string
  credentialsPath: string
  /** 可拉起的本地 sidecar 可执行文件;null 表示本环境不支持(WSL) */
  kimiExe: string | null
  /** 实例探测的主机候选(依次尝试) */
  hosts: string[]
  /** 状态缓存的键(每环境独立的端口/plan 缓存) */
  cacheKey: string
}

function windowsEnv(): KimiEnv {
  return {
    serverTokenPath: join(KIMI_DIR, 'server.token'),
    credentialsPath: join(KIMI_DIR, 'credentials', 'kimi-code.json'),
    kimiExe: join(KIMI_DIR, 'bin', 'kimi.exe'),
    hosts: ['127.0.0.1'],
    cacheKey: 'windows'
  }
}

async function wslEnv(): Promise<KimiEnv | null> {
  const home = await getWslHomeUncPath()
  if (!home) return null
  const wslIp = await getWslIpAddress()
  return {
    serverTokenPath: join(home, '.kimi-code', 'server.token'),
    credentialsPath: join(home, '.kimi-code', 'credentials', 'kimi-code.json'),
    kimiExe: null,
    // localhostForwarding/mirrored 下 127.0.0.1 即可达;NAT 下要 WSL IP。都试。
    hosts: wslIp ? ['127.0.0.1', wslIp] : ['127.0.0.1'],
    cacheKey: 'wsl'
  }
}

/** 我们拉起的 sidecar;退出时只杀自己这个,用户已有的实例不碰(仅 Windows 环境) */
let ownedSidecar: ChildProcess | null = null
/** 已发现的实例端口(按环境缓存),避免每次轮询都扫 101 个端口 */
const discoveredPort = new Map<string, number>()
/** plan 缓存(按环境;两侧可能是不同账号) */
const cachedUserInfo = new Map<string, KimiUserInfo>()

// ---------- 解析(纯函数,单测覆盖) ----------

interface KimiWindowRaw {
  duration: number | null
  unit: string | null
  used: number | null
  limit: number | null
  resetAt: string | null
}

function normalizeWindowUnit(raw: Record<string, unknown> | null): {
  duration: number | null
  unit: string | null
} {
  if (!raw) return { duration: null, unit: null }
  const duration = asNumber(raw.duration)
  // 本地服务:{duration:1,unit:'week'};云端:{duration:300,timeUnit:'TIME_UNIT_MINUTE'}
  const unit = asString(raw.unit) ?? asString(raw.timeUnit)
  return { duration, unit: unit ? unit.toLowerCase().replace('time_unit_', '') : null }
}

function kimiWindowLabel(duration: number | null, unit: string | null): { key: string; label: string } {
  if (unit === 'week') return { key: 'weekly', label: 'Weekly' }
  if (unit === 'hour' && duration === 5) return { key: '5h', label: '5h' }
  if (unit === 'hour') return { key: `${duration ?? '?'}h`, label: `${duration ?? '?'}h` }
  if (unit === 'minute' && duration !== null) {
    const hours = duration / 60
    if (Math.abs(hours - 5) <= 0.2) return { key: '5h', label: '5h' }
    return { key: `${duration}m`, label: `${duration}m` }
  }
  if (unit === 'day') return { key: `${duration ?? 1}d`, label: duration === 1 ? 'Daily' : `${duration}d` }
  return { key: unit ?? 'window', label: unit ?? 'Window' }
}

function toWindow(raw: KimiWindowRaw): QuotaWindow | null {
  if (raw.used === null || raw.limit === null || raw.limit <= 0) return null
  const { key, label } = kimiWindowLabel(raw.duration, raw.unit)
  return {
    key,
    label,
    usedPercent: Math.min(100, Math.max(0, (raw.used / raw.limit) * 100)),
    resetsAt: raw.resetAt
  }
}

function parseWindowLike(node: Record<string, unknown> | null): KimiWindowRaw | null {
  if (!node) return null
  const detail = asRecord(node.detail)
  const src = detail ?? node
  const { duration, unit } = normalizeWindowUnit(asRecord(node.window))
  return {
    duration,
    unit,
    used: asNumber(src.used),
    limit: asNumber(src.limit),
    resetAt: asString(src.reset_at) ?? asString(src.resetTime)
  }
}

/**
 * 本地服务响应:{code, data:{kind, summary, limits[], extra_usage}}
 * 云端响应:{usage:{limit,used,resetTime}, limits[{window,detail}], ...}
 * 两者统一解析为窗口列表。
 */
export function parseKimiUsage(json: unknown): {
  windows: QuotaWindow[]
  extras: Array<{ label: string; value: string }>
} {
  const root = asRecord(json)
  const data = asRecord(root?.data) ?? root
  if (!data) return { windows: [], extras: [] }

  const windows: QuotaWindow[] = []
  // 本地服务 summary / 云端 usage:主窗口(通常为周)
  const summary = parseWindowLike(asRecord(data.summary) ?? asRecord(data.usage))
  // 云端 usage 不带 window 字段;实测该主额度即 Kimi Code 周额度
  // (resetTime 与本地服务周窗口 reset_at 一致,见 docs/quota-research-kimi.md)
  if (summary && summary.unit === null) summary.unit = 'week'
  const main = summary ? toWindow(summary) : null
  if (main) windows.push(main)

  const limits = Array.isArray(data.limits) ? data.limits : []
  for (const item of limits) {
    const parsed = parseWindowLike(asRecord(item))
    const win = parsed ? toWindow(parsed) : null
    if (win && !windows.some((w) => w.key === win.key)) windows.push(win)
  }

  const extras: Array<{ label: string; value: string }> = []
  const extra = asRecord(data.extra_usage)
  if (extra) {
    const balanceCents = asNumber(extra.balanceCents)
    if (balanceCents !== null) {
      extras.push({ label: 'Extra usage', value: `¥${(balanceCents / 100).toFixed(2)}` })
    }
  }
  return { windows, extras }
}

/** 账号资料:订阅档位 + 远端账号身份(拿不到为 null) */
export interface KimiUserInfo {
  plan: string | null
  userId: string | null
}

export function parseKimiUserinfo(json: unknown): KimiUserInfo {
  const data = asRecord(asRecord(json)?.data) ?? asRecord(json)
  return {
    plan: asString(data?.userLevelName),
    // 本地服务 userinfo:{code,data:{userId,...}};云端 /me 形如 data.user.userId
    userId:
      asString(data?.userId) ?? asString(asRecord(data?.user)?.userId)
  }
}

/** 云端 usages 响应里的 user.userId(降级链路的身份来源) */
export function parseKimiCloudUserId(json: unknown): string | null {
  return asString(asRecord(asRecord(json)?.user)?.userId)
}

// ---------- 采集 ----------

function readServerToken(env: KimiEnv): string | null {
  try {
    const token = readFileSync(env.serverTokenPath, 'utf-8').trim()
    return token === '' ? null : token
  } catch {
    return null
  }
}

async function probeInstance(host: string, port: number): Promise<boolean> {
  try {
    await getJson(`http://${host}:${port}/api/v1/healthz`, {}, HEALTH_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

async function scanInstances(env: KimiEnv): Promise<{ host: string; port: number } | null> {
  for (const host of env.hosts) {
    const ports: number[] = []
    for (let p = PORT_MIN; p <= PORT_MAX; p++) ports.push(p)
    const results = await Promise.all(ports.map(async (p) => ((await probeInstance(host, p)) ? p : null)))
    const port = results.find((p) => p !== null)
    if (port !== null && port !== undefined) return { host, port }
  }
  return null
}

/** 拉起 kimi web sidecar 并等它就绪;返回实际监听端口(kimi 被占会自动 +1,所以起完再扫) */
async function spawnSidecar(env: KimiEnv): Promise<{ host: string; port: number } | null> {
  if (!env.kimiExe || !existsSync(env.kimiExe)) return null
  if (ownedSidecar && ownedSidecar.exitCode === null) {
    // 已拉起过:等它就绪后重扫
  } else {
    ownedSidecar = spawn(env.kimiExe, ['web', '--no-open', '--port', String(PORT_MIN)], {
      stdio: 'ignore',
      windowsHide: true
    })
    ownedSidecar.on('error', () => {
      ownedSidecar = null
    })
  }
  const deadline = Date.now() + SIDECAR_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const found = await scanInstances(env)
    if (found) return found
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

export function disposeKimiSidecar(): void {
  if (ownedSidecar && ownedSidecar.exitCode === null) {
    try {
      ownedSidecar.kill()
    } catch {
      // 已经退出
    }
  }
  ownedSidecar = null
}

/** 本地服务不可用时,用未过期的 access_token 直连云端;绝不自行刷新 token */
function readFreshAccessToken(env: KimiEnv): string | null {
  try {
    const raw = asRecord(JSON.parse(readFileSync(env.credentialsPath, 'utf-8')))
    const expiresAt = asNumber(raw?.expires_at)
    const token = asString(raw?.access_token)
    // 留 60s 余量;过期则不碰(由 CLI 自己刷新)
    if (!token || expiresAt === null || expiresAt * 1000 < Date.now() + 60_000) return null
    return token
  } catch {
    return null
  }
}

export async function collectKimiQuota(origin: UsageOrigin = 'windows'): Promise<{
  windows: QuotaWindow[]
  extras: Array<{ label: string; value: string }>
  plan: string | null
  remoteUserId: string | null
}> {
  const env = origin === 'wsl' ? await wslEnv() : windowsEnv()
  if (!env) throw new Error('WSL not available')
  const token = readServerToken(env)

  if (token) {
    let found: { host: string; port: number } | null = null
    const cached = discoveredPort.get(env.cacheKey)
    if (cached !== undefined && (await probeInstance(env.hosts[0], cached))) {
      found = { host: env.hosts[0], port: cached }
    } else {
      found = (await scanInstances(env)) ?? (await spawnSidecar(env))
      if (found) discoveredPort.set(env.cacheKey, found.port)
    }
    if (found) {
      const base = `http://${found.host}:${found.port}`
      const auth = { Authorization: `Bearer ${token}` }
      const usage = await getJson(`${base}/api/v1/oauth/usage?provider=managed:kimi-code`, auth, REQUEST_TIMEOUT_MS)
      // 账号资料只查一次(plan + userId),失败不影响主数据
      if (!cachedUserInfo.has(env.cacheKey)) {
        try {
          cachedUserInfo.set(
            env.cacheKey,
            parseKimiUserinfo(
              await getJson(`${base}/api/v1/oauth/userinfo?provider=managed:kimi-code`, auth, REQUEST_TIMEOUT_MS)
            )
          )
        } catch {
          cachedUserInfo.set(env.cacheKey, { plan: null, userId: null })
        }
      }
      const parsed = parseKimiUsage(usage)
      const info = cachedUserInfo.get(env.cacheKey)
      return { ...parsed, plan: info?.plan ?? null, remoteUserId: info?.userId ?? null }
    }
  }

  // 降级:云端直连(token 未过期才用)
  const accessToken = readFreshAccessToken(env)
  if (!accessToken) {
    throw new Error(
      origin === 'wsl'
        ? 'kimi web not running inside WSL and access token expired (start `kimi web` in WSL, or re-login)'
        : 'kimi web unavailable and access token expired'
    )
  }
  const cloud = await getJson(
    'https://api.kimi.com/coding/v1/usages',
    { Authorization: `Bearer ${accessToken}` },
    REQUEST_TIMEOUT_MS
  )
  const parsed = parseKimiUsage(cloud)
  const info = cachedUserInfo.get(env.cacheKey)
  return {
    ...parsed,
    plan: info?.plan ?? null,
    // 云端响应自带 user.userId;本地服务缓存的身份优先
    remoteUserId: info?.userId ?? parseKimiCloudUserId(cloud)
  }
}

export async function kimiCredentialExists(origin: UsageOrigin = 'windows'): Promise<boolean> {
  const env = origin === 'wsl' ? await wslEnv() : windowsEnv()
  if (!env) return false
  return readServerToken(env) !== null || readFreshAccessToken(env) !== null || existsSync(env.credentialsPath)
}
