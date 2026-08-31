/**
 * Cursor quota provider。
 *
 * 主采集:GET https://cursor.com/api/usage-summary(带本机登录态 cookie)
 * - 凭据 = Cursor 自己的 state.vscdb(cursorAuth/accessToken + cachedAuthId),
 *   见 src/main/cursor/auth.ts;token 只在主进程内存,不进 IPC / 日志
 * - 401 时不自行 refresh(避免与 Cursor 客户端抢写登录态),提示用户开一次 Cursor
 *
 * 响应(2026-08-31 实测,Pro 账号):
 *   { billingCycleStart, billingCycleEnd, membershipType, isUnlimited,
 *     individualUsage: { plan: { used, limit, remaining, breakdown: { included, bonus, total },
 *                                autoPercentUsed, apiPercentUsed, totalPercentUsed },
 *                        onDemand: { enabled, used, limit, remaining } }, teamUsage }
 * 百分比优先用服务端给的 totalPercentUsed(按模型定价加权),缺失才用 used/total 兜底。
 * 详见 docs/quota-research-cursor.md。
 */
import { readCursorAuth } from '../cursor/auth'
import { fetchCursorUsageSummary } from '../cursor/api'
import { asNumber, asRecord, asString } from './http'
import type { QuotaCredential, QuotaWindow } from './types'

/** 是否有 Cursor 登录态(读 state.vscdb) */
export function cursorCredentialExists(): boolean {
  return readCursorAuth() !== null
}

/** 纯解析,单测覆盖;上游 schema 漂移时空窗口 + 可展示 extras,不抛 */
export function parseCursorUsageSummary(json: unknown): {
  windows: QuotaWindow[]
  extras: Array<{ label: string; value: string }>
  plan: string | null
} {
  const root = asRecord(json)
  const windows: QuotaWindow[] = []
  const extras: Array<{ label: string; value: string }> = []

  const membershipType = asString(root?.membershipType)
  if (membershipType) {
    const planName = membershipType.charAt(0).toUpperCase() + membershipType.slice(1)
    extras.push({ label: 'Plan', value: planName })
  }

  const individual = asRecord(root?.individualUsage)
  const planUsage = asRecord(individual?.plan)
  if (planUsage) {
    const used = asNumber(planUsage.used)
    const limit = asNumber(planUsage.limit)
    const breakdown = asRecord(planUsage.breakdown)
    const bonus = asNumber(breakdown?.bonus)
    const total = asNumber(breakdown?.total)
    const apiPercent = asNumber(planUsage.totalPercentUsed)
    const fallbackPercent = used !== null && total !== null && total > 0 ? (used / total) * 100 : null
    const usedPercent = apiPercent ?? fallbackPercent
    if (usedPercent !== null) {
      windows.push({
        key: 'included',
        label: 'Included usage',
        usedPercent: Math.min(100, Math.max(0, usedPercent)),
        resetsAt: asString(root?.billingCycleEnd)
      })
    }
    const parts: string[] = []
    if (used !== null) {
      parts.push(limit !== null ? `${used} / ${limit} requests` : `${used} requests`)
      if (bonus !== null && bonus > 0) parts.push(`+${bonus} bonus`)
    }
    if (parts.length > 0) extras.push({ label: 'Requests', value: parts.join(' ') })
  }

  const onDemand = asRecord(individual?.onDemand)
  const onDemandUsed = asNumber(onDemand?.used)
  if (onDemand && onDemandUsed !== null && onDemandUsed > 0) {
    const limit = asNumber(onDemand?.limit)
    extras.push({
      label: 'On-demand',
      value: limit !== null ? `$${onDemandUsed.toFixed(2)} / $${limit.toFixed(2)}` : `$${onDemandUsed.toFixed(2)}`
    })
  }

  if (windows.length === 0) throw new Error('Unexpected Cursor usage-summary shape')
  return { windows, extras, plan: membershipType ? membershipType.charAt(0).toUpperCase() + membershipType.slice(1) : null }
}

/**
 * @param cred 仅 local:Cursor 登录态没有可粘贴的 token(和 Kimi 一样不支持 manual 多账号)。
 */
export async function collectCursorQuota(cred: QuotaCredential): Promise<{
  windows: QuotaWindow[]
  extras: Array<{ label: string; value: string }>
  plan: string | null
  remoteUserId: string | null
}> {
  if (cred.source === 'manual') throw new Error('Cursor uses the local login only')
  const auth = readCursorAuth()
  if (!auth) throw new Error('No Cursor login found — open Cursor once to sign in')
  const json = await fetchCursorUsageSummary(auth)
  const parsed = parseCursorUsageSummary(json)
  return { ...parsed, remoteUserId: auth.userId }
}
