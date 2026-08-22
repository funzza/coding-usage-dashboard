import type { SourceCollectResult } from '../../shared/usage-model'
import { adaptZcodeRows } from './adapter'
import { loadZcodeDailyRows } from './reader'

/**
 * 采集 zcode 本地 usage 并归一化;任何失败都体现在 status 上,绝不抛异常。
 * 同步执行(本地 SQLite 聚合查询约几十毫秒),挂在 ccusage 刷新链路之后。
 */
export function collectZcodeUsage(): SourceCollectResult {
  const { rows, error } = loadZcodeDailyRows()
  if (!rows) {
    return error
      ? { daily: null, status: { state: 'skipped', reason: error } }
      : { daily: null, status: { state: 'absent' } }
  }
  return { daily: adaptZcodeRows(rows), status: { state: 'ok' } }
}
