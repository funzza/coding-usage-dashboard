/**
 * 轮次状态机测试(docs/quota-rounds-plan.md §13 全部场景)。
 * 通过公共 API(initRounds/ingestQuota/ingestSessions)+ 可注入存储目录驱动,
 * 不触 Electron;每个用例用 vi.resetModules 取全新模块实例。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { zeroUsage } from '../../shared/usage-model'
import type { SessionReport, SessionUsage } from '../../shared/usage-model'
import type { QuotaAccount, QuotaSnapshot, QuotaWindow, TrackedQuotaProvider } from './types'

type RoundsModule = typeof import('./rounds')

const RESET_A = '2026-09-01T00:00:00.000Z'
const RESET_B = '2026-10-01T00:00:00.000Z'

/** 合法 ISO 时间戳(秒偏移);持久化校验要求真实可解析日期 */
const BASE_MS = Date.parse('2026-08-24T00:00:00.000Z')
const S = (offsetSec: number): string => new Date(BASE_MS + offsetSec * 1000).toISOString()

// ---------- fixture 工厂 ----------

function quotaAcct(provider: TrackedQuotaProvider, over: Partial<QuotaAccount> = {}): QuotaAccount {
  return {
    accountId: `local:${provider}`,
    provider,
    agent: provider,
    origin: undefined,
    displayName: provider,
    label: provider,
    source: 'local',
    plan: null,
    remoteUserId: 'u1',
    status: 'ok',
    windows: [{ key: 'weekly', label: 'Weekly', usedPercent: 45, resetsAt: RESET_A }],
    extras: [],
    updatedAt: null,
    error: null,
    ...over
  }
}

function snapAt(generatedAt: string, accounts: QuotaAccount[]): QuotaSnapshot {
  return { generatedAt, accounts }
}

/** 单 provider 单窗口的 quota 快照 */
function oneSample(
  t: string,
  provider: TrackedQuotaProvider,
  percent: number,
  opts: { resetsAt?: string | null; userId?: string | null } = {}
): QuotaSnapshot {
  const windows: QuotaWindow[] = [
    {
      key: 'weekly',
      label: 'Weekly',
      usedPercent: percent,
      resetsAt: opts.resetsAt !== undefined ? opts.resetsAt : RESET_A
    }
  ]
  return snapAt(t, [
    quotaAcct(provider, { windows, remoteUserId: opts.userId !== undefined ? opts.userId : 'u1' })
  ])
}

function sess(agent: TrackedQuotaProvider, totalTokens: number): SessionUsage {
  return {
    id: `${agent}-${totalTokens}`,
    agent,
    origin: 'windows',
    lastActivity: null,
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens,
    totalCost: 0,
    models: []
  }
}

function rep(generatedAt: string, entries: Array<[TrackedQuotaProvider, number]>): SessionReport {
  return {
    engine: { version: 'test', path: 'ccusage' },
    generatedAt,
    refreshDurationMs: 0,
    totals: zeroUsage(),
    sessions: entries.map(([agent, n]) => sess(agent, n))
  }
}

// ---------- 模块实例与依赖 ----------

let tmpDir = ''
let nextReport: SessionReport | null = null
let fetchImpl: () => Promise<SessionReport | null> = async () => nextReport

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'quota-rounds-'))
  nextReport = null
  fetchImpl = async () => nextReport
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

async function makeRounds(): Promise<RoundsModule> {
  vi.resetModules()
  const mod = await import('./rounds')
  mod.configureRoundsStorage(tmpDir)
  return mod
}

/** 经由队列的间接引用:测试中途替换 fetchImpl 对 deps 同样生效;延迟归零保证确定性 */
function currentDeps(): { fetchSessionReport: () => Promise<SessionReport | null>; bootFetchDelayMs: number } {
  return { fetchSessionReport: () => fetchImpl(), bootFetchDelayMs: 0 }
}

async function flushed(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

describe('§5 边界判定(quota 采样驱动)', () => {
  it('1. 45→44 且 identity/resetsAt 不变:不关闭', async () => {
    const mod = await makeRounds()
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 45))
    await mod.ingestQuota(oneSample(S(120), 'kimi', 44))
    const v = mod.getRoundsView().providers.kimi
    expect(v.current).not.toBeNull()
    expect(v.current?.lastPercent).toBe(44)
    expect(v.history).toHaveLength(0)
  })

  it('2. 70→1:百分比兜底关闭', async () => {
    const mod = await makeRounds()
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 70))
    await mod.ingestQuota(oneSample(S(120), 'kimi', 1))
    const v = mod.getRoundsView().providers.kimi
    expect(v.current?.startPercent).toBe(1)
    expect(v.previous?.endPercent).toBe(70)
    expect(v.previous?.boundaryReason).toBe('percent-rollback')
  })

  it('3. 100→20:关闭并开新轮', async () => {
    const mod = await makeRounds()
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 100))
    await mod.ingestQuota(oneSample(S(120), 'kimi', 20))
    const v = mod.getRoundsView().providers.kimi
    expect(v.history).toHaveLength(1)
    expect(v.previous?.startPercent).toBe(100)
    expect(v.previous?.endPercent).toBe(100)
    expect(v.previous?.exhausted).toBe(true)
    expect(v.current?.startPercent).toBe(20)
    expect(v.current?.exhausted).toBe(false)
    // consumedPercent = max(0, end - start)
    expect(v.previous?.consumedPercent).toBe(0)
  })

  it('4. 100→100 且 remoteUserId 改变:按切号关闭', async () => {
    const mod = await makeRounds()
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 100))
    await mod.ingestQuota(oneSample(S(120), 'kimi', 100, { userId: 'u2' }))
    const v = mod.getRoundsView().providers.kimi
    expect(v.previous?.boundaryReason).toBe('account-switch')
    expect(v.previous?.remoteUserId).toBe('u1')
    expect(v.current?.remoteUserId).toBe('u2')
  })

  it('5. remoteUserId 暂时变 null:不覆盖已有身份', async () => {
    const mod = await makeRounds()
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 45))
    await mod.ingestQuota(oneSample(S(120), 'kimi', 44, { userId: null }))
    const v = mod.getRoundsView().providers.kimi
    expect(v.current?.remoteUserId).toBe('u1')
    expect(v.current?.lastPercent).toBe(44)
    expect(v.history).toHaveLength(0)
  })

  it('6. stable resetsAt 改变且新轮已使用到 8%:仍识别周期重置', async () => {
    const mod = await makeRounds()
    mod.initRounds(currentDeps())
    // 同一 resetsAt 连续两次确认后才启用 period-reset 信号
    await mod.ingestQuota(oneSample(S(60), 'kimi', 0, { resetsAt: RESET_A }))
    await mod.ingestQuota(oneSample(S(120), 'kimi', 2, { resetsAt: RESET_A }))
    await mod.ingestQuota(oneSample(S(180), 'kimi', 8, { resetsAt: RESET_B }))
    const v = mod.getRoundsView().providers.kimi
    expect(v.previous?.boundaryReason).toBe('period-reset')
    expect(v.current?.startPercent).toBe(8)
    expect(v.current?.lastResetsAt).toBe(RESET_B)
  })

  it('7. resetsAt 为 null/非法日期:不抛错,不做日期运算', async () => {
    const mod = await makeRounds()
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'grok', 45, { resetsAt: 'not-a-date' }))
    await mod.ingestQuota(oneSample(S(120), 'grok', 44, { resetsAt: null }))
    const v = mod.getRoundsView().providers.grok
    expect(v.current?.lastResetsAt).toBeNull()
    expect(v.current?.lastPercent).toBe(44)
    expect(v.history).toHaveLength(0)
  })

  it('8. status error 且保留旧 windows:状态机不更新', async () => {
    const mod = await makeRounds()
    // 纯提取:error 账号即使带着旧 windows 也产不出 sample
    const errored = snapAt(S(30), [quotaAcct('kimi', { status: 'error', updatedAt: S(20) })])
    expect(mod.extractSamples(errored).size).toBe(0)

    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 45))
    const before = mod.getRoundsView().providers.kimi.current?.lastObservedAt
    await mod.ingestQuota(snapAt(S(90), [quotaAcct('kimi', { status: 'error' })]))
    expect(mod.getRoundsView().providers.kimi.current?.lastObservedAt).toBe(before)
  })
})

describe('§4 主窗口选择', () => {
  it('weekly 优先;rolling/短窗被排除;不可解析时只认 monthly/credits', async () => {
    const mod = await makeRounds()
    const w = (key: string, percent = 10): QuotaWindow => ({ key, label: key, usedPercent: percent, resetsAt: null })
    expect(mod.selectPrimaryWindow([w('5h'), w('weekly'), w('30m')])?.key).toBe('weekly')
    expect(mod.selectPrimaryWindow([w('5h'), w('12h')])?.key ?? null).toBeNull()
    expect(mod.selectPrimaryWindow([w('daily'), w('3d')])?.key).toBe('3d')
    expect(mod.selectPrimaryWindow([w('monthly'), w('credits')])?.key).toBe('monthly')
    expect(mod.selectPrimaryWindow([w('credits'), w('unknown')])?.key).toBe('credits')
  })
})

describe('§6/§7 token 差分与状态机', () => {
  it('9. 首次 session 报告只建立三个 provider baseline', async () => {
    const mod = await makeRounds()
    nextReport = rep(S(10), [
      ['kimi', 1000],
      ['codex', 2000],
      ['grok', 3000]
    ])
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 45))
    const v = mod.getRoundsView().providers
    expect(v.kimi.current?.tokens.totalTokens).toBe(0)
    expect(v.codex.current).toBeNull()
    expect(v.grok.current).toBeNull()
    // baseline 已建立:sampling=false
    expect(v.kimi.sampling).toBe(false)
    expect(v.codex.sampling).toBe(false)
    expect(v.grok.sampling).toBe(false)
  })

  it('10. 新 session 出现导致 provider 总量增长:完整增长进入 delta', async () => {
    const mod = await makeRounds()
    nextReport = rep(S(10), [['kimi', 1000]])
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 45))
    await mod.ingestSessions(rep(S(50), [['kimi', 1600]]))
    expect(mod.getRoundsView().providers.kimi.current?.tokens.totalTokens).toBe(600)
  })

  it('11. provider 累计值下降:delta 为 0,baseline 更新到较小值', async () => {
    const mod = await makeRounds()
    nextReport = rep(S(10), [['kimi', 1000]])
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 45))
    await mod.ingestSessions(rep(S(50), [['kimi', 1600]]))
    await mod.ingestSessions(rep(S(70), [['kimi', 1200]])) // 回落:delta 0
    await mod.ingestSessions(rep(S(80), [['kimi', 1300]])) // 从 1200 起算:+100
    expect(mod.getRoundsView().providers.kimi.current?.tokens.totalTokens).toBe(700)
  })

  it('12. 同一 session 报告被普通刷新和边界路径复用:只消费一次', async () => {
    const mod = await makeRounds()
    nextReport = rep(S(10), [['kimi', 1000]])
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 100))
    const reused = rep(S(50), [['kimi', 1500]])
    await mod.ingestSessions(reused) // 普通刷新消费:delta 500
    // 边界路径复用同一份报告(generatedAt 相同):判重跳过
    fetchImpl = async () => reused
    await mod.ingestQuota(oneSample(S(120), 'kimi', 20))
    const v = mod.getRoundsView().providers.kimi
    expect(v.previous?.tokens.totalTokens).toBe(500)
    expect(v.current?.tokens.totalTokens).toBe(0)
    // 之后的新报告照常差分
    await mod.ingestSessions(rep(S(200), [['kimi', 1700]]))
    expect(mod.getRoundsView().providers.kimi.current?.tokens.totalTokens).toBe(200)
  })

  it('13. 在线边界时未消费 delta 全部进入新轮;旧轮保留原 estimated,新轮为 false', async () => {
    const mod = await makeRounds()
    nextReport = rep(S(10), [['kimi', 1000]])
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 100)) // 首次接入:estimated
    await mod.ingestSessions(rep(S(50), [['kimi', 1600]])) // 旧轮累计 600
    fetchImpl = async () => rep(S(90), [['kimi', 1800]]) // 边界附带报告:+200 未消费
    await mod.ingestQuota(oneSample(S(120), 'kimi', 20))
    const v = mod.getRoundsView().providers.kimi
    expect(v.previous?.tokens.totalTokens).toBe(600)
    expect(v.previous?.estimated).toBe(true)
    expect(v.previous?.estimatedReason).toBe('bootstrap')
    expect(v.current?.tokens.totalTokens).toBe(200)
    expect(v.current?.estimated).toBe(false)
    expect(v.current?.estimatedReason).toBeNull()
  })

  it('14. 首次接入创建的 current 为 estimated;它在线关闭时旧轮保持 estimated,新轮为 false', async () => {
    const mod = await makeRounds()
    nextReport = null // baseline 尚缺也不影响轮次创建
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 100))
    fetchImpl = async () => null
    await mod.ingestQuota(oneSample(S(120), 'kimi', 20))
    const v = mod.getRoundsView().providers.kimi
    expect(v.previous?.estimated).toBe(true)
    expect(v.previous?.estimatedReason).toBe('bootstrap')
    expect(v.current?.estimated).toBe(false)
    expect(v.current?.estimatedReason).toBeNull()
  })

  it('17. CurrentRound.exhausted 在达到阈值和开新轮后正确更新', async () => {
    const mod = await makeRounds()
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 50))
    expect(mod.getRoundsView().providers.kimi.current?.exhausted).toBe(false)
    await mod.ingestQuota(oneSample(S(120), 'kimi', 100)) // 达阈值,无边界
    expect(mod.getRoundsView().providers.kimi.current?.exhausted).toBe(true)
    await mod.ingestQuota(oneSample(S(180), 'kimi', 20)) // 关闭开新轮
    const v = mod.getRoundsView().providers.kimi
    expect(v.previous?.exhausted).toBe(true)
    expect(v.current?.exhausted).toBe(false)
  })
})

describe('§8 重启恢复', () => {
  /** 预置一个可重启的状态:bootstrap 轮已在线关闭,当前是普通非 estimated 轮(tokens=500) */
  async function seedRestartable(): Promise<{ startAt: string }> {
    const mod = await makeRounds()
    nextReport = rep(S(10), [['kimi', 400]])
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 100))
    // 在线关闭 bootstrap 轮,得到一个非 estimated 的普通轮,便于验证离线强标
    fetchImpl = async () => null
    await mod.ingestQuota(oneSample(S(120), 'kimi', 20))
    await mod.ingestSessions(rep(S(50), [['kimi', 900]])) // 普通轮累计 500
    await mod.flushRounds()
    const view = mod.getRoundsView().providers.kimi
    expect(view.current?.estimated).toBe(false)
    expect(view.current?.tokens.totalTokens).toBe(500)
    return { startAt: view.current!.startAt }
  }

  it('15. 重启无边界:离线 delta 加入原 current,estimated 状态不变', async () => {
    const seeded = await seedRestartable()
    fetchImpl = async () => nextReport // 还原 seed 阶段替换的实现
    const mod = await makeRounds()
    nextReport = rep(S(300), [['kimi', 2500]]) // 离线期间涨到 2500
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(180), 'kimi', 21))
    const v = mod.getRoundsView().providers.kimi
    expect(v.history).toHaveLength(1) // 无新轮
    expect(v.current?.startAt).toBe(seeded.startAt)
    expect(v.current?.tokens.totalTokens).toBe(2100) // 500 + (2500 - 900)
    expect(v.current?.estimated).toBe(false)
  })

  it('16. 重启有边界:离线 delta 丢弃并重建 baseline,不伪造中间轮,旧/新轮均为 estimated', async () => {
    await seedRestartable()
    fetchImpl = async () => nextReport // 还原 seed 阶段替换的实现
    const mod = await makeRounds()
    nextReport = rep(S(300), [['kimi', 999]]) // 离线期间跨了未知边界后的读数
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(180), 'kimi', 3)) // 20→3:回退边界(离线)
    const v = mod.getRoundsView().providers.kimi
    // 不伪造中间轮:历史只有重启前那一条已关闭轮 + 本次离线关闭的普通轮
    expect(v.history).toHaveLength(2)
    const closed = v.previous!
    expect(closed.endPercent).toBe(20)
    expect(closed.tokens.totalTokens).toBe(500) // 已归属的保留
    expect(closed.estimated).toBe(true) // 离线跨边界强制标记
    expect(closed.estimatedReason).toBe('offline-boundary')
    expect(v.current?.startPercent).toBe(3)
    expect(v.current?.tokens.totalTokens).toBe(0) // 离线 delta 丢弃
    expect(v.current?.estimated).toBe(true)
    expect(v.current?.estimatedReason).toBe('offline-boundary')
    // baseline 已重建:后续增量正常归属
    await mod.ingestSessions(rep(S(400), [['kimi', 1099]]))
    expect(mod.getRoundsView().providers.kimi.current?.tokens.totalTokens).toBe(100)
  })
})

describe('§7 状态队列与持久化', () => {
  it('18. ingestQuota 与 ingestSessions 并发:状态按队列串行', async () => {
    const mod = await makeRounds()
    nextReport = rep(S(10), [['kimi', 1000]])
    mod.initRounds(currentDeps())
    await mod.ingestQuota(oneSample(S(60), 'kimi', 100))

    let release!: (r: SessionReport | null) => void
    fetchImpl = () =>
      new Promise<SessionReport | null>((resolve) => {
        release = resolve
      })
    // 并发发起:边界处理先入队并停在 fetch 上;session 结算必须等它完成
    const p1 = mod.ingestQuota(oneSample(S(120), 'kimi', 1))
    const p2 = mod.ingestSessions(rep(S(50), [['kimi', 1500]]))
    await vi.waitFor(() => expect(release).toBeDefined())
    release(rep(S(90), [['kimi', 1200]]))
    await Promise.all([p1, p2])

    const v = mod.getRoundsView().providers.kimi
    // 串行语义:边界先结算(baseline 1000→1200,+200 入新轮);
    // 后到的 T1b(generatedAt 早于 baseline.sampledAt)整份跳过,不会双算
    expect(v.previous?.tokens.totalTokens).toBe(0)
    expect(v.current?.tokens.totalTokens).toBe(200)
  })

  it('19. current/baseline 空值使用 null;损坏 JSON 可恢复', async () => {
    // 合法空文件:null 一律保留,不触发 quarantine
    const emptyFile = {
      version: 1,
      current: { kimi: null, codex: null, grok: null },
      history: { kimi: [], codex: [], grok: [] },
      baselines: { kimi: null, codex: null, grok: null }
    }
    writeFileSync(join(tmpDir, 'quota-rounds.json'), JSON.stringify(emptyFile), 'utf-8')
    const modA = await makeRounds()
    modA.initRounds(currentDeps())
    await flushed()
    const va = modA.getRoundsView().providers
    expect(va.kimi.current).toBeNull()
    expect(va.kimi.previous).toBeNull()
    expect(va.kimi.history).toEqual([])
    expect(va.kimi.sampling).toBe(true)
    expect(existsSync(join(tmpDir, 'quota-rounds.json'))).toBe(true)
    expect(readdirSync(tmpDir).some((f) => f.includes('.broken-'))).toBe(false)

    // 损坏文件:改名保留后重新初始化
    writeFileSync(join(tmpDir, 'quota-rounds.json'), '{oops not json', 'utf-8')
    const modB = await makeRounds()
    modB.initRounds(currentDeps())
    await flushed()
    expect(modB.getRoundsView().providers.kimi.current).toBeNull()
    expect(readdirSync(tmpDir).some((f) => f.startsWith('quota-rounds.json.broken-'))).toBe(true)
    // 原样可回读(证据被保留)
    const broken = readdirSync(tmpDir).find((f) => f.startsWith('quota-rounds.json.broken-'))
    expect(readFileSync(join(tmpDir, broken!), 'utf-8')).toBe('{oops not json')
  })
})
