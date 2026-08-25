import type { SourceCollectResult, SourceStatus, UsageOrigin } from '../../shared/usage-model'
import { adaptDshRows } from './adapter'
import { loadDshDailyRows } from './reader'

export interface CollectDshOptions {
  /** sessions 根目录;缺省为本机(Windows)默认位置。WSL 侧传 \\wsl.localhost\... UNC 路径 */
  root?: string
  /** 数据来源环境标注;WSL 侧传 'wsl' */
  origin?: UsageOrigin
}

/**
 * 采集 dsh usage(解析 session.jsonl.zstd 事件流)并归一化。
 * 全部失败路径都收敛为 status,绝不抛异常、不影响 ccusage 主链路。
 * 注意:UNC(WSL)下每次目录列举/读文件都是 9P 网络往返,扫描比本地慢;
 * mtime+size 增量缓存可复用(key 为绝对路径,Windows/WSL 两套根天然隔离)。
 */
export function collectDshUsage(opts: CollectDshOptions = {}): SourceCollectResult {
  let result: ReturnType<typeof loadDshDailyRows>
  try {
    result = loadDshDailyRows(opts.root)
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
  return { daily: adaptDshRows(result.rows, opts.origin), status }
}
