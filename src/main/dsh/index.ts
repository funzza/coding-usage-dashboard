import type { SourceCollectResult, SourceStatus } from '../../shared/usage-model'
import { adaptDshRows } from './adapter'
import { loadDshDailyRows } from './reader'

/**
 * 采集 dsh 本地 usage(解析 session.jsonl.zstd 事件流)并归一化。
 * 全部失败路径都收敛为 status,绝不抛异常、不影响 ccusage 主链路。
 */
export function collectDshUsage(): SourceCollectResult {
  let result: ReturnType<typeof loadDshDailyRows>
  try {
    result = loadDshDailyRows()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[dsh] scan failed:', message)
    return { daily: null, status: { state: 'skipped', reason: message } }
  }
  if (!result) return { daily: null, status: { state: 'absent' } }
  if (result.totalFiles > 0 && result.rows.length === 0 && result.skippedFiles === result.totalFiles) {
    return { daily: null, status: { state: 'skipped', reason: 'all session files unrecognized (dsh update?)' } }
  }
  const status: SourceStatus =
    result.skippedFiles > 0
      ? { state: 'ok', reason: `${result.skippedFiles}/${result.totalFiles} session files skipped` }
      : { state: 'ok' }
  return { daily: adaptDshRows(result.rows), status }
}
