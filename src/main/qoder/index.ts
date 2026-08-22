import { app } from 'electron'
import { join } from 'node:path'
import type { SourceCollectResult } from '../../shared/usage-model'
import { adaptQoderRows } from './adapter'
import { loadQoderDailyRows } from './reader'

/**
 * 采集 Qoder 本地 usage 并归一化;任何失败都体现在 status 上,绝不抛异常。
 * 同步执行(本地 SQLite 聚合约几十毫秒),挂在 ccusage 刷新链路之后。
 */

/** BYOK 模型删除后无法再解析名字,把 id→名字映射持久化到 userData 兜底;非 Electron 环境(测试)静默退化为无缓存 */
function modelNameCachePath(): string | undefined {
  try {
    return join(app.getPath('userData'), 'qoder-model-names.json')
  } catch {
    return undefined
  }
}

export function collectQoderUsage(): SourceCollectResult {
  const { rows, error } = loadQoderDailyRows(undefined, undefined, modelNameCachePath())
  if (!rows) {
    return error
      ? { daily: null, status: { state: 'skipped', reason: error } }
      : { daily: null, status: { state: 'absent' } }
  }
  return { daily: adaptQoderRows(rows), status: { state: 'ok' } }
}
