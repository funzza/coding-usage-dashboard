import { adaptDailyReport, adaptSessionReport } from '../ccusage/adapter'
import { locateCcusage } from '../ccusage/locator'
import { runCcusageJson } from '../ccusage/runner'
import { collectZcodeUsage } from '../zcode'
import { ZCODE_AGENT } from '../zcode/adapter'
import { collectDshUsage } from '../dsh'
import { DSH_AGENT } from '../dsh/adapter'
import { collectQoderUsage } from '../qoder'
import { QODER_AGENT } from '../qoder/adapter'
import { mergeDailyIntoSnapshot } from '../../shared/usage-model'
import type {
  DetectResult,
  EngineInfo,
  RefreshResult,
  SessionReport,
  SessionsResult,
  SourceCollectResult,
  UsageSnapshot
} from '../../shared/usage-model'

/**
 * Usage 编排服务:主进程内唯一的 usage 数据入口。
 * ccusage 是主引擎;EXTRA_SOURCES(zcode/dsh 等本地源)在快照之后合并,
 * 全部 fail-soft,任何额外源失败都不影响 ccusage 主链路。
 *
 * 刷新策略(单次 ccusage 调用约 17s,严禁高频):
 * - 每次刷新只 spawn 一个 ccusage 进程:`daily --json --by-agent`
 * - in-flight 守卫:并发调用共享同一个 Promise,不会并行 spawn
 * - 成功结果缓存为 lastSnapshot;失败时返回缓存,不清空
 * - 记录 refreshDurationMs 供性能观测
 */
const REFRESH_ARGS = ['daily', '--json', '--by-agent']
const REFRESH_TIMEOUT_MS = 120_000
/** session 维度按需加载(Sessions 页面),绝不并入常规 refresh */
const SESSION_ARGS = ['session', '--json', '--by-agent']
const SESSION_TIMEOUT_MS = 120_000

let cachedDetect: DetectResult | null = null
let lastSnapshot: UsageSnapshot | null = null
let inflightRefresh: Promise<RefreshResult> | null = null
let refreshListener: ((result: RefreshResult) => void) | null = null

let lastSessionReport: SessionReport | null = null
let inflightSessions: Promise<SessionsResult> | null = null

/** 注册刷新完成回调(tray 菜单更新、renderer 广播) */
export function setRefreshListener(listener: (result: RefreshResult) => void): void {
  refreshListener = listener
}

export function getLastSnapshot(): UsageSnapshot | null {
  return lastSnapshot
}

/**
 * 额外数据源(ccusage 未覆盖的 agent):每个源自包含 collect,fail-soft。
 * 防双算:ccusage 将来若支持同名 agent(snapshot 里出现),本地源自动让位。
 */
const EXTRA_SOURCES: Array<{ name: string; collect: () => SourceCollectResult }> = [
  { name: ZCODE_AGENT, collect: collectZcodeUsage },
  { name: DSH_AGENT, collect: collectDshUsage },
  { name: QODER_AGENT, collect: collectQoderUsage }
]

function mergeExtraSources(snapshot: UsageSnapshot): void {
  for (const source of EXTRA_SOURCES) {
    if (snapshot.agents.some((a) => a.agent === source.name)) {
      snapshot.sources[source.name] = { state: 'skipped', reason: 'covered by ccusage' }
      continue
    }
    const { daily, status } = source.collect()
    snapshot.sources[source.name] = status
    if (daily && daily.length > 0) mergeDailyIntoSnapshot(snapshot, daily)
  }
}

export async function detectCcusage(force = false): Promise<DetectResult> {
  if (!cachedDetect || force || !cachedDetect.found) {
    cachedDetect = await locateCcusage()
  }
  return cachedDetect
}

/** 触发一次刷新;已有刷新在进行时返回同一个 Promise */
export function refreshUsage(): Promise<RefreshResult> {
  if (!inflightRefresh) {
    inflightRefresh = doRefresh().finally(() => {
      inflightRefresh = null
    })
  }
  return inflightRefresh
}

async function doRefresh(): Promise<RefreshResult> {
  const detect = await detectCcusage()
  let result: RefreshResult
  if (!detect.found || !detect.path || !detect.version) {
    result = { ok: false, error: 'ccusage was not found on this machine.', snapshot: lastSnapshot }
  } else {
    const engine: EngineInfo = { version: detect.version, path: detect.path }
    const startedAt = performance.now()
    try {
      const raw = await runCcusageJson(detect.path, REFRESH_ARGS, REFRESH_TIMEOUT_MS)
      const durationMs = Math.round(performance.now() - startedAt)
      const snapshot = adaptDailyReport(raw, engine, new Date(), durationMs)
      mergeExtraSources(snapshot)
      lastSnapshot = snapshot
      result = { ok: true, snapshot }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 可执行文件消失(例如被卸载)时清掉定位缓存,下次重新探测
      if (/failed to start ccusage/.test(message)) {
        cachedDetect = null
      }
      result = { ok: false, error: message, snapshot: lastSnapshot }
    }
  }
  refreshListener?.(result)
  return result
}

/**
 * 按需加载 session 维度数据(Sessions 页面进入/点 Refresh 时调用)。
 * 与 refreshUsage 相同的守卫策略:并发共享同一个 Promise,成功缓存,失败返回缓存+错误。
 */
export function getSessions(): Promise<SessionsResult> {
  if (!inflightSessions) {
    inflightSessions = doGetSessions().finally(() => {
      inflightSessions = null
    })
  }
  return inflightSessions
}

async function doGetSessions(): Promise<SessionsResult> {
  const detect = await detectCcusage()
  if (!detect.found || !detect.path || !detect.version) {
    return { ok: false, error: 'ccusage was not found on this machine.', report: lastSessionReport }
  }
  const engine: EngineInfo = { version: detect.version, path: detect.path }
  const startedAt = performance.now()
  try {
    const raw = await runCcusageJson(detect.path, SESSION_ARGS, SESSION_TIMEOUT_MS)
    const durationMs = Math.round(performance.now() - startedAt)
    const report = adaptSessionReport(raw, engine, new Date(), durationMs)
    lastSessionReport = report
    return { ok: true, report }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/failed to start ccusage/.test(message)) {
      cachedDetect = null
    }
    return { ok: false, error: message, report: lastSessionReport }
  }
}
