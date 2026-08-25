import { describe, expect, it } from 'vitest'
import type { QuotaAccount } from '../../../main/quota/types'
import {
  QUOTA_CRITICAL_PERCENT,
  QUOTA_WARN_PERCENT,
  quotaAlarmLevel,
  resolveQuotaAlarm
} from './ball'

function account(accountId: string, percents: number[]): QuotaAccount {
  return {
    accountId,
    provider: 'kimi',
    agent: 'kimi',
    displayName: 'Kimi',
    label: accountId,
    source: 'local',
    plan: null,
    remoteUserId: null,
    status: 'ok',
    windows: percents.map((p, i) => ({
      key: `w${i}`,
      label: `Window ${i}`,
      usedPercent: p,
      resetsAt: null
    })),
    extras: [],
    updatedAt: null,
    error: null
  }
}

describe('quotaAlarmLevel', () => {
  it('thresholds: <90 null, 90–97 warn, >=98 critical', () => {
    expect(quotaAlarmLevel(0)).toBeNull()
    expect(quotaAlarmLevel(89.9)).toBeNull()
    expect(quotaAlarmLevel(QUOTA_WARN_PERCENT)).toBe('warn')
    expect(quotaAlarmLevel(97)).toBe('warn')
    expect(quotaAlarmLevel(QUOTA_CRITICAL_PERCENT)).toBe('critical')
    expect(quotaAlarmLevel(100)).toBe('critical')
  })
})

describe('resolveQuotaAlarm', () => {
  it('returns null when no accounts or all windows below threshold', () => {
    expect(resolveQuotaAlarm([])).toBeNull()
    expect(resolveQuotaAlarm([account('a', [])])).toBeNull()
    expect(resolveQuotaAlarm([account('a', [10, 89])])).toBeNull()
  })

  it('picks the tightest window across accounts and windows', () => {
    const alarm = resolveQuotaAlarm([
      account('a', [95, 50]),
      account('b', [92]),
      account('c', [99])
    ])!
    expect(alarm.level).toBe('critical')
    expect(alarm.accountId).toBe('c')
    expect(alarm.windowLabel).toBe('Window 0')
    expect(alarm.usedPercent).toBe(99)
  })

  it('warn when the worst window is below critical', () => {
    const alarm = resolveQuotaAlarm([account('a', [91]), account('b', [80])])!
    expect(alarm.level).toBe('warn')
    expect(alarm.accountId).toBe('a')
  })
})
