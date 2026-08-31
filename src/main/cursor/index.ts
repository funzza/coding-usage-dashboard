import type { SourceCollectResult, UsageOrigin } from '../../shared/usage-model'
import { adaptCursorRows, parseCursorUsageCsv } from './adapter'
import { fetchCursorUsageCsv, toCursorApiError } from './api'
import { readCursorAuth } from './auth'

export { CURSOR_AGENT } from './adapter'

export interface CollectCursorOptions {
  /** 数据来源环境标注;Cursor 走账号 API,默认 windows */
  origin?: UsageOrigin
}

/**
 * 采集 Cursor usage 并归一化;任何失败都体现在 status 上,绝不抛异常。
 * 与 zcode/dsh/qoder 不同,Cursor 没有本地 token 明细(aiCodeTracking 只有行数),
 * 只能带本机登录态调官方接口。挂在 5 分钟一次的刷新链路,单次请求秒级。
 */
export async function collectCursorUsage(opts: CollectCursorOptions = {}): Promise<SourceCollectResult> {
  const auth = readCursorAuth()
  if (!auth) {
    return {
      daily: null,
      status: { state: 'absent', reason: 'no Cursor login detected (open Cursor once to sign in)' }
    }
  }
  try {
    const csv = await fetchCursorUsageCsv(auth)
    const rows = parseCursorUsageCsv(csv)
    if (!rows) {
      return { daily: null, status: { state: 'skipped', reason: 'Cursor usage CSV schema changed' } }
    }
    if (rows.length === 0) return { daily: [], status: { state: 'ok' } }
    return { daily: adaptCursorRows(rows, opts.origin), status: { state: 'ok' } }
  } catch (err) {
    return { daily: null, status: { state: 'skipped', reason: toCursorApiError(err) } }
  }
}
