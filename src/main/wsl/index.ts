import { adaptDailyReport, adaptSessionReport } from '../ccusage/adapter'
import { runWslJson } from './executor'
import type { WslDetectResult } from './locator'
import { markWslDaily, markWslSessions } from './adapter'
import type {
  DailyUsage,
  SessionUsage,
  SourceStatus
} from '../../shared/usage-model'

/**
 * WSL(默认发行版)内 ccusage 的采集入口。
 * 定位缓存由 usage service 管理(与 Windows 侧 cachedDetect 同策略),
 * 本模块只负责"给定定位结果 → 执行 → 归一化 → 加 WSL 后缀"。
 * 全部 fail-soft:任何失败收敛为 SourceStatus,不抛出。
 */
const REFRESH_ARGS = ['daily', '--json', '--by-agent']
const SESSION_ARGS = ['session', '--json', '--by-agent']
const RUN_TIMEOUT_MS = 120_000

export interface WslDailyResult {
  daily: DailyUsage[] | null
  status: SourceStatus
}

export interface WslSessionsResult {
  sessions: SessionUsage[] | null
  status: SourceStatus
}

export { locateWslCcusage } from './locator'
export { getWslHomeUncPath, getWslIpAddress } from './home'
export { WSL_CCUSAGE_SOURCE } from './adapter'
export type { WslDetectResult } from './locator'

/** 未 found 的定位结果 → absent 状态 */
function absentStatus(detect: WslDetectResult): SourceStatus {
  return { state: 'absent', reason: detect.reason ?? 'ccusage was not found inside WSL' }
}

/** 执行成功后的 ok 状态,reason 携带引擎信息供 Settings 展示 */
function okStatus(detect: WslDetectResult): SourceStatus {
  return { state: 'ok', reason: `via WSL ccusage ${detect.version} (${detect.path})` }
}

export async function collectWslCcusageDaily(detect: WslDetectResult): Promise<WslDailyResult> {
  if (!detect.found || !detect.path || !detect.version) {
    return { daily: null, status: absentStatus(detect) }
  }
  try {
    const raw = await runWslJson([detect.path, ...REFRESH_ARGS], RUN_TIMEOUT_MS)
    const snapshot = adaptDailyReport(raw, { version: detect.version, path: detect.path })
    return { daily: markWslDaily(snapshot.daily), status: okStatus(detect) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { daily: null, status: { state: 'skipped', reason: message } }
  }
}

export async function collectWslCcusageSessions(detect: WslDetectResult): Promise<WslSessionsResult> {
  if (!detect.found || !detect.path || !detect.version) {
    return { sessions: null, status: absentStatus(detect) }
  }
  try {
    const raw = await runWslJson([detect.path, ...SESSION_ARGS], RUN_TIMEOUT_MS)
    const report = adaptSessionReport(raw, { version: detect.version, path: detect.path })
    return { sessions: markWslSessions(report.sessions), status: okStatus(detect) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { sessions: null, status: { state: 'skipped', reason: message } }
  }
}
