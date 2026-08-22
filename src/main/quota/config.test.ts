/**
 * quota 账号配置的合并逻辑测试(纯函数,不触 Electron 持久化)。
 * 重点:默认 local 账号生成、旧配置兼容(缺 enabled 视为启用)、未知 provider 剔除。
 */
import { describe, expect, it } from 'vitest'
import { defaultAccounts, mergeWithDefaults } from './config'
import type { QuotaAccountConfig, QuotaProviderId } from './types'

const ALL: readonly QuotaProviderId[] = ['kimi', 'codex', 'opencode-go', 'grok']

describe('defaultAccounts', () => {
  it('每个 provider 生成一个启用的 local 账号', () => {
    const accounts = defaultAccounts(ALL)
    expect(accounts).toHaveLength(4)
    expect(accounts[0]).toMatchObject({ id: 'local:kimi', provider: 'kimi', source: 'local', enabled: true })
  })
})

describe('mergeWithDefaults', () => {
  it('空配置 → 全部默认 local 账号', () => {
    const merged = mergeWithDefaults([], ALL)
    expect(merged.map((a) => a.id).sort()).toEqual([
      'local:codex',
      'local:grok',
      'local:kimi',
      'local:opencode-go'
    ])
  })

  it('保留手动账号与禁用状态,补齐缺失 provider 的 local 账号', () => {
    const stored: QuotaAccountConfig[] = [
      { id: 'local:grok', provider: 'grok', source: 'local', label: '', enabled: false },
      { id: 'manual:grok:abc', provider: 'grok', source: 'manual', label: 'Work', enabled: true, tokenEnc: 'enc' }
    ]
    const merged = mergeWithDefaults(stored, ALL)
    expect(merged.find((a) => a.id === 'local:grok')?.enabled).toBe(false)
    expect(merged.find((a) => a.id === 'manual:grok:abc')?.label).toBe('Work')
    // 其余三个 provider 的 local 账号被补上
    for (const id of ['kimi', 'codex', 'opencode-go'] as const) {
      expect(merged.some((a) => a.id === `local:${id}`)).toBe(true)
    }
  })

  it('旧版配置缺 enabled 字段视为启用;未知 provider 的账号被剔除', () => {
    const legacy = [
      { id: 'local:kimi', provider: 'kimi', source: 'local', label: '' },
      { id: 'manual:alibaba:x', provider: 'alibaba', source: 'manual', label: 'Old', enabled: true }
  ] as unknown as QuotaAccountConfig[]
    const merged = mergeWithDefaults(legacy, ALL)
    expect(merged.find((a) => a.id === 'local:kimi')?.enabled).toBe(true)
    expect(merged.some((a) => a.provider === ('alibaba' as QuotaProviderId))).toBe(false)
  })
})
