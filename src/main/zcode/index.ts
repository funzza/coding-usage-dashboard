import type { SourceCollectResult, UsageOrigin } from '../../shared/usage-model'
import { adaptZcodeRows } from './adapter'
import { loadZcodeDailyRows } from './reader'

export interface CollectZcodeOptions {
  /** db 路径;缺省为本机(Windows)默认位置。WSL 侧传 \\wsl.localhost\... UNC 路径 */
  dbPath?: string
  /** 数据来源环境标注;WSL 侧传 'wsl' */
  origin?: UsageOrigin
}

/**
 * 采集 zcode usage 并归一化;任何失败都体现在 status 上,绝不抛异常。
 * 同步执行(本地 SQLite 聚合查询约几十毫秒),挂在 ccusage 刷新链路之后。
 * 注意:UNC 路径(WSL)下走"复制到本地 tmp 再读"分支,同步复制会阻塞主进程
 * 数秒(库可达上百 MB),当前挂在 5 分钟一次的刷新链路上可接受,后续可移 worker。
 */
export function collectZcodeUsage(opts: CollectZcodeOptions = {}): SourceCollectResult {
  const { rows, error } = loadZcodeDailyRows(opts.dbPath)
  if (!rows) {
    return error
      ? { daily: null, status: { state: 'skipped', reason: error } }
      : { daily: null, status: { state: 'absent' } }
  }
  return { daily: adaptZcodeRows(rows, opts.origin), status: { state: 'ok' } }
}
