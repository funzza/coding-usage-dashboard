import { adaptDailyReport, adaptSessionReport, sortSessionsByLastActivity } from '../ccusage/adapter'
import { locateCcusage } from '../ccusage/locator'
import { runCcusageJson } from '../ccusage/runner'
import { collectZcodeUsage } from '../zcode'
import { ZCODE_AGENT } from '../zcode/adapter'
import { collectDshUsage } from '../dsh'
import { DSH_AGENT } from '../dsh/adapter'
import { collectQoderUsage } from '../qoder'
import { QODER_AGENT } from '../qoder/adapter'
import {
  collectWslCcusageDaily,
  collectWslCcusageSessions,
  getWslHomeUncPath,
  locateWslCcusage,
  WSL_CCUSAGE_SOURCE
} from '../wsl'
import type { WslDetectResult } from '../wsl'
import { join } from 'node:path'
import { addUsage, mergeDailyIntoSnapshot, zeroUsage } from '../../shared/usage-model'
import type {
  DailyUsage,
  DetectResult,
  EngineInfo,
  RefreshResult,
  SessionReport,
  SessionsResult,
  SessionUsage,
  SourceCollectResult,
  SourceStatus,
  UsageOrigin,
  UsageSnapshot
} from '../../shared/usage-model'

/**
 * Usage 编排服务:主进程内唯一的 usage 数据入口。
 * ccusage 是主引擎;EXTRA_SOURCES(zcode/dsh 等本地源)与 WSL 内的 ccusage
 * 在快照之后合并,全部 fail-soft,任何额外源失败都不影响 ccusage 主链路。
 *
 * 刷新策略(单次 ccusage 调用约 17s,严禁高频):
 * - 每次刷新只 spawn 一个 Windows ccusage 进程;WSL 侧 ccusage 并行执行
 *   (发行版冷启动慢,提前启动流水线,最终只等待合并)
 * - in-flight 守卫:并发调用共享同一个 Promise,不会并行 spawn
 * - 成功结果缓存为 lastSnapshot;失败时返回缓存,不清空
 * - 记录 refreshDurationMs 供性能观测
 */
const REFRESH_ARGS = ['daily', '--json', '--by-agent']
const REFRESH_TIMEOUT_MS = 120_000
/** session 维度按需加载(Sessions 页面),绝不并入常规 refresh */
const SESSION_ARGS = ['session', '--json', '--by-agent']
const SESSION_TIMEOUT_MS = 120_000

// ---------- ccusage 独占 FIFO 队列(Windows 侧) ----------
// Windows daily(120s 轮询/手动刷新)与 Windows session(Sessions 页面/quota 轮次采样)
// 各自的单飞 Promise 只防同类并发;两类同时触发仍可能并行 spawn 两个 ccusage 进程。
// 这里加一个简单 FIFO:后到者排在当前任务之后,不实现优先级与取消;WSL 不走此队列。

let exclusiveTail: Promise<unknown> = Promise.resolve()

function runCcusageExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = exclusiveTail.then(task, task)
  exclusiveTail = run.catch(() => undefined)
  return run
}

let cachedDetect: DetectResult | null = null
let cachedWslDetect: WslDetectResult | null = null
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
 * 防双算:ccusage 将来若支持同名 agent(snapshot 里出现同名同 origin 条目),
 * 本地源自动让位。守卫按 (agent, origin) 双匹配——Windows/WSL 两侧互不干扰。
 */
const EXTRA_SOURCES: Array<{
  name: string
  origin: UsageOrigin
  collect: () => SourceCollectResult
}> = [
  { name: ZCODE_AGENT, origin: 'windows', collect: () => collectZcodeUsage() },
  { name: DSH_AGENT, origin: 'windows', collect: () => collectDshUsage() },
  { name: QODER_AGENT, origin: 'windows', collect: () => collectQoderUsage() }
]

/**
 * WSL 侧文件型数据源:根路径依赖运行时发现的 WSL home(UNC)。
 * wslHome 为 null(WSL 不可用)时不注册——WSL 环境整体缺席由 wsl-ccusage 状态行代表。
 */
function wslFileSources(wslHome: string): Array<{
  name: string
  origin: UsageOrigin
  collect: () => SourceCollectResult
}> {
  return [
    {
      name: 'zcode-wsl',
      origin: 'wsl',
      collect: () =>
        collectZcodeUsage({ dbPath: join(wslHome, '.zcode', 'cli', 'db', 'db.sqlite'), origin: 'wsl' })
    },
    {
      name: 'dsh-wsl',
      origin: 'wsl',
      collect: () => collectDshUsage({ root: join(wslHome, '.dsh', 'sessions'), origin: 'wsl' })
    }
  ]
}

function mergeExtraSources(snapshot: UsageSnapshot, wslHome: string | null): void {
  const sources = [...EXTRA_SOURCES, ...(wslHome ? wslFileSources(wslHome) : [])]
  for (const source of sources) {
    const covered = snapshot.agents.some(
      (a) => a.agent === source.name && (a.origin ?? 'windows') === source.origin
    )
    if (covered) {
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

/** WSL 侧定位,缓存策略与 detectCcusage 一致(未 found 时下次仍重试) */
export async function detectWslCcusage(force = false): Promise<WslDetectResult> {
  if (!cachedWslDetect || force || !cachedWslDetect.found) {
    cachedWslDetect = await locateWslCcusage()
  }
  return cachedWslDetect
}

/**
 * WSL 采集流水线:定位 → 执行 → 归一化。立即启动、永不 reject,
 * 与 Windows 主链路并行执行;结果(含失败状态)由调用方决定是否消费。
 */
function startWslDailyPipeline(): Promise<{ daily: DailyUsage[] | null; status: SourceStatus }> {
  return detectWslCcusage()
    .then((detect) => collectWslCcusageDaily(detect))
    .catch(() => ({
      daily: null,
      status: { state: 'skipped' as const, reason: 'WSL collection failed unexpectedly' }
    }))
}

function startWslSessionsPipeline(): Promise<{ sessions: SessionUsage[] | null }> {
  return detectWslCcusage()
    .then((detect) => collectWslCcusageSessions(detect))
    .then((r) => ({ sessions: r.sessions }))
    .catch(() => ({ sessions: null }))
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
  // WSL 两条流水线先启动(发行版冷启动慢),与 Windows 主链路并行:
  // ccusage 执行 + WSL home UNC 路径发现(文件型源要用)
  const wslPipeline = startWslDailyPipeline()
  const wslHomePromise = getWslHomeUncPath()
  const detect = await detectCcusage()
  let result: RefreshResult
  if (!detect.found || !detect.path || !detect.version) {
    result = { ok: false, error: 'ccusage was not found on this machine.', snapshot: lastSnapshot }
  } else {
    const engine: EngineInfo = { version: detect.version, path: detect.path }
    const exePath = detect.path
    const startedAt = performance.now()
    try {
      const raw = await runCcusageExclusive(() =>
        runCcusageJson(exePath, REFRESH_ARGS, REFRESH_TIMEOUT_MS)
      )
      const durationMs = Math.round(performance.now() - startedAt)
      const snapshot = adaptDailyReport(raw, engine, new Date(), durationMs)
      // WSL ccusage 先并入:WSL 文件源的防双算守卫要看到它的 (agent, wsl) 条目
      await mergeWslDaily(snapshot, wslPipeline)
      mergeExtraSources(snapshot, await wslHomePromise)
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

/** 等待 WSL 流水线结果并并入快照;任何失败只落 sources 状态,不影响主链路 */
async function mergeWslDaily(
  snapshot: UsageSnapshot,
  wslPipeline: Promise<{ daily: DailyUsage[] | null; status: SourceStatus }>
): Promise<void> {
  const { daily, status } = await wslPipeline
  snapshot.sources[WSL_CCUSAGE_SOURCE] = status
  if (daily && daily.length > 0) {
    mergeDailyIntoSnapshot(snapshot, daily)
  }
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
  const wslPipeline = startWslSessionsPipeline()
  const detect = await detectCcusage()
  if (!detect.found || !detect.path || !detect.version) {
    return { ok: false, error: 'ccusage was not found on this machine.', report: lastSessionReport }
  }
  const engine: EngineInfo = { version: detect.version, path: detect.path }
  const exePath = detect.path
  const startedAt = performance.now()
  try {
    const raw = await runCcusageExclusive(() =>
      runCcusageJson(exePath, SESSION_ARGS, SESSION_TIMEOUT_MS)
    )
    const durationMs = Math.round(performance.now() - startedAt)
    const report = adaptSessionReport(raw, engine, new Date(), durationMs)
    const { sessions: wslSessions } = await wslPipeline
    if (wslSessions && wslSessions.length > 0) {
      mergeWslSessions(report, wslSessions)
    }
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

/** WSL sessions 并入报告:合并、按最近活动重排序、totals 重算 */
function mergeWslSessions(report: SessionReport, wslSessions: SessionUsage[]): void {
  report.sessions = [...report.sessions, ...wslSessions]
  sortSessionsByLastActivity(report.sessions)
  const totals = zeroUsage()
  for (const s of report.sessions) {
    addUsage(totals, s)
  }
  report.totals = totals
}
