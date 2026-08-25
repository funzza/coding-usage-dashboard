/**
 * Quota 周期用量(Round)状态机 —— docs/quota-rounds-plan.md 的实现。
 *
 * 核心原则:优先保证不重复计数。token 用 provider 累计总量差分(不存 per-session cursor);
 * `estimated` 只表示首次接入或离线跨边界两类实质性不确定;在线边界最多横跨一个 5min
 * 采样间隔的归属偏差是已接受的系统误差,不改变 estimated。
 *
 * 结构:
 * - 持久化:userData/quota-rounds.json(version/current/history/baselines,空值一律 null),
 *   临时文件 + rename 原子写;损坏文件改名保留后重建
 * - 边界信号优先级:远端身份变化 > 固定 resetsAt 变化 > 百分比强回退;
 *   运行期与重启恢复复用同一个 detectBoundary()
 * - 一个简单 Promise 队列串行 ingestQuota()/ingestSessions(),防止并发改状态
 */
import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { addUsage, zeroUsage } from '../../shared/usage-model'
import type { SessionReport, TokenUsage } from '../../shared/usage-model'
import type {
  CurrentRound,
  EstimatedReason,
  ProviderTokenBaseline,
  QuotaAccount,
  QuotaRound,
  QuotaRoundBoundaryReason,
  QuotaSnapshot,
  QuotaWindow,
  RoundsView,
  TrackedQuotaProvider
} from './types'

const TRACKED_PROVIDERS = ['kimi', 'codex', 'grok'] as const
const LOW_WATERMARK = 5
const EXHAUSTED_WATERMARK = 99
const MIN_ROLLBACK_DROP = 10
const HISTORY_LIMIT = 100

/** ccusage session 维度采样周期(§9/§14:5min) */
export const SESSION_SAMPLE_INTERVAL_MS = 5 * 60_000

export interface PrimaryQuotaSample {
  provider: TrackedQuotaProvider
  observedAt: string
  usedPercent: number
  resetsAt: string | null
  remoteUserId: string | null
}

export function percentRollback(prev: number, curr: number): boolean {
  const drop = prev - curr
  if (drop < MIN_ROLLBACK_DROP) return false
  return prev >= EXHAUSTED_WATERMARK || curr <= LOW_WATERMARK
}

export function detectBoundary(
  current: CurrentRound,
  sample: PrimaryQuotaSample,
  stableResetsAt: boolean
): QuotaRoundBoundaryReason | null {
  if (
    current.remoteUserId !== null &&
    sample.remoteUserId !== null &&
    current.remoteUserId !== sample.remoteUserId
  ) {
    return 'account-switch'
  }

  if (
    stableResetsAt &&
    current.lastResetsAt !== null &&
    sample.resetsAt !== null &&
    current.lastResetsAt !== sample.resetsAt
  ) {
    return 'period-reset'
  }

  return percentRollback(current.lastPercent, sample.usedPercent)
    ? 'percent-rollback'
    : null
}

// ---------- 主窗口选择与采样提取 ----------

/** 短时滑窗(Nh/Nm)视为 rolling,不作为主窗口 */
function isRollingKey(key: string): boolean {
  return /^\d+[hm]$/.test(key)
}

/** 可解析为固定周期长度的 key;无法解析返回 null(monthly/credits 等走已知名单兜底) */
function parseableLengthMs(key: string): number | null {
  if (key === 'daily') return 86_400_000
  const m = /^(\d+)d$/.exec(key)
  return m ? Number(m[1]) * 86_400_000 : null
}

/**
 * 主窗口选择:weekly 优先;否则排除 5h 与 rolling 后取可解析周期最长者;
 * 无法解析长度时只接受已知的 monthly / credits(monthly 优先)。
 */
export function selectPrimaryWindow(windows: QuotaWindow[]): QuotaWindow | null {
  const weekly = windows.find((w) => w.key === 'weekly')
  if (weekly) return weekly

  const candidates = windows.filter((w) => w.key !== '5h' && !isRollingKey(w.key))
  let best: { win: QuotaWindow; ms: number } | null = null
  const knownOrder = ['monthly', 'credits']
  let known: QuotaWindow | null = null
  for (const win of candidates) {
    const ms = parseableLengthMs(win.key)
    if (ms !== null) {
      if (!best || ms > best.ms) best = { win, ms }
    } else {
      const rank = knownOrder.indexOf(win.key)
      if (rank >= 0 && (!known || rank < knownOrder.indexOf(known.key))) known = win
    }
  }
  return best?.win ?? known ?? null
}

function normalizeReset(iso: string | null): string | null {
  if (!iso) return null
  return Number.isFinite(Date.parse(iso)) ? iso : null
}

function clampPercent(v: number): number {
  return Math.min(100, Math.max(0, v))
}

/** 每个 provider 至多选一个 Windows local 且 status==='ok' 的账号;error 快照不进状态机 */
export function extractSamples(
  snapshot: QuotaSnapshot | null
): Map<TrackedQuotaProvider, PrimaryQuotaSample> {
  const samples = new Map<TrackedQuotaProvider, PrimaryQuotaSample>()
  if (!snapshot) return samples
  for (const provider of TRACKED_PROVIDERS) {
    const account = snapshot.accounts.find(
      (a: QuotaAccount) =>
        a.provider === provider &&
        a.source === 'local' &&
        (a.origin ?? 'windows') === 'windows' &&
        a.status === 'ok'
    )
    if (!account) continue
    const win = selectPrimaryWindow(account.windows)
    if (!win) continue
    samples.set(provider, {
      provider,
      observedAt: snapshot.generatedAt,
      usedPercent: clampPercent(win.usedPercent),
      resetsAt: normalizeReset(win.resetsAt),
      remoteUserId: account.remoteUserId
    })
  }
  return samples
}

// ---------- provider 级 token 差分 ----------

const AGENT_TO_PROVIDER: Record<string, TrackedQuotaProvider> = {
  kimi: 'kimi',
  codex: 'codex',
  grok: 'grok'
}

/** 只汇总 Windows 本地 origin;按 agent 映射 provider 后累计 */
export function providerTotalsFromReport(
  report: SessionReport
): Map<TrackedQuotaProvider, TokenUsage> {
  const totals = new Map<TrackedQuotaProvider, TokenUsage>()
  for (const s of report.sessions) {
    if ((s.origin ?? 'windows') !== 'windows') continue
    const provider = AGENT_TO_PROVIDER[s.agent]
    if (!provider) continue
    let acc = totals.get(provider)
    if (!acc) {
      acc = zeroUsage()
      totals.set(provider, acc)
    }
    addUsage(acc, s)
  }
  return totals
}

/** 逐字段做非负差分:累计值回落的字段 delta 记 0,由 baseline 直接推进到较小值 */
export function usageDelta(current: TokenUsage, previous: TokenUsage): TokenUsage {
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    cacheReadTokens: Math.max(0, current.cacheReadTokens - previous.cacheReadTokens),
    cacheCreationTokens: Math.max(0, current.cacheCreationTokens - previous.cacheCreationTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
    totalCost: Math.max(0, current.totalCost - previous.totalCost)
  }
}

// ---------- 持久化 ----------

interface RoundsFile {
  version: 1
  current: Record<TrackedQuotaProvider, CurrentRound | null>
  history: Record<TrackedQuotaProvider, QuotaRound[]>
  baselines: Record<TrackedQuotaProvider, ProviderTokenBaseline | null>
}

interface RoundsState {
  current: Record<TrackedQuotaProvider, CurrentRound | null>
  history: Record<TrackedQuotaProvider, QuotaRound[]>
  baselines: Record<TrackedQuotaProvider, ProviderTokenBaseline | null>
}

let storageDirOverride: string | null = null

/** 主进程启动注入 userData;测试注入临时目录(必须在首次读写前调用) */
export function configureRoundsStorage(dir: string | null): void {
  storageDirOverride = dir
}

function storageFile(): string | null {
  if (storageDirOverride !== null) return join(storageDirOverride, 'quota-rounds.json')
  try {
    if (typeof app?.getPath === 'function') return join(app.getPath('userData'), 'quota-rounds.json')
  } catch {
    // app 未就绪(理论上不会发生)
  }
  return null
}

function emptyRecord<T>(): Record<TrackedQuotaProvider, T | null> {
  return { kimi: null, codex: null, grok: null }
}

function emptyState(): RoundsState {
  return {
    current: emptyRecord<CurrentRound>(),
    history: { kimi: [], codex: [], grok: [] },
    baselines: emptyRecord<ProviderTokenBaseline>()
  }
}

function isValidDateStr(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(Date.parse(v))
}

/** 条目级校验:字段类型不符的条目直接丢弃(整文件级问题走 quarantine) */
function sanitizeCurrent(v: unknown, provider: TrackedQuotaProvider): CurrentRound | null {
  const rec = v as Partial<CurrentRound> | null
  if (!rec || typeof rec !== 'object') return null
  if (
    typeof rec.startPercent !== 'number' ||
    typeof rec.lastPercent !== 'number' ||
    !isValidDateStr(rec.startAt) ||
    !isValidDateStr(rec.lastObservedAt) ||
    !rec.tokens ||
    typeof rec.tokens.totalTokens !== 'number'
  ) {
    return null
  }
  return {
    provider,
    remoteUserId: typeof rec.remoteUserId === 'string' ? rec.remoteUserId : null,
    startAt: rec.startAt,
    startPercent: rec.startPercent,
    lastPercent: rec.lastPercent,
    lastResetsAt: isValidDateStr(rec.lastResetsAt) ? rec.lastResetsAt : null,
    lastObservedAt: rec.lastObservedAt,
    tokens: { ...zeroUsage(), ...rec.tokens },
    exhausted: rec.exhausted === true,
    estimated: rec.estimated === true,
    estimatedReason:
      rec.estimatedReason === 'bootstrap' || rec.estimatedReason === 'offline-boundary'
        ? rec.estimatedReason
        : null
  }
}

function sanitizeRound(v: unknown, provider: TrackedQuotaProvider): QuotaRound | null {
  const rec = v as Partial<QuotaRound> | null
  if (!rec || typeof rec !== 'object') return null
  if (
    typeof rec.startPercent !== 'number' ||
    typeof rec.endPercent !== 'number' ||
    !isValidDateStr(rec.startAt) ||
    !isValidDateStr(rec.endAt) ||
    !isValidDateStr(rec.closedAt) ||
    !rec.tokens ||
    typeof rec.tokens.totalTokens !== 'number' ||
    (rec.boundaryReason !== 'period-reset' &&
      rec.boundaryReason !== 'account-switch' &&
      rec.boundaryReason !== 'percent-rollback')
  ) {
    return null
  }
  return {
    provider,
    remoteUserId: typeof rec.remoteUserId === 'string' ? rec.remoteUserId : null,
    startAt: rec.startAt,
    endAt: rec.endAt,
    startPercent: rec.startPercent,
    endPercent: rec.endPercent,
    consumedPercent: typeof rec.consumedPercent === 'number' ? rec.consumedPercent : 0,
    tokens: { ...zeroUsage(), ...rec.tokens },
    exhausted: rec.exhausted === true,
    boundaryReason: rec.boundaryReason,
    estimated: rec.estimated === true,
    estimatedReason:
      rec.estimatedReason === 'bootstrap' || rec.estimatedReason === 'offline-boundary'
        ? rec.estimatedReason
        : null,
    closedAt: rec.closedAt
  }
}

function sanitizeBaseline(v: unknown): ProviderTokenBaseline | null {
  const rec = v as Partial<ProviderTokenBaseline> | null
  if (!rec || !isValidDateStr(rec.sampledAt) || !rec.usage || typeof rec.usage.totalTokens !== 'number') {
    return null
  }
  return { usage: { ...zeroUsage(), ...rec.usage }, sampledAt: rec.sampledAt }
}

function quarantine(file: string): void {
  try {
    renameSync(file, `${file}.broken-${Date.now()}`)
  } catch {
    // 改名失败也只能放弃旧文件
  }
}

function loadState(): RoundsState {
  const file = storageFile()
  if (!file) return emptyState()
  let raw: string
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    return emptyState()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    quarantine(file)
    return emptyState()
  }
  const rec = parsed as Partial<RoundsFile> | null
  if (!rec || typeof rec !== 'object' || rec.version !== 1) {
    quarantine(file)
    return emptyState()
  }
  const state = emptyState()
  for (const p of TRACKED_PROVIDERS) {
    const rawCurrent = (rec.current as Record<string, unknown> | undefined)?.[p]
    state.current[p] = rawCurrent === undefined ? null : sanitizeCurrent(rawCurrent, p)
    const rawHistory = (rec.history as Record<string, unknown> | undefined)?.[p]
    if (Array.isArray(rawHistory)) {
      state.history[p] = rawHistory
        .map((item) => sanitizeRound(item, p))
        .filter((r): r is QuotaRound => r !== null)
        .slice(-HISTORY_LIMIT)
    }
    const rawBaseline = (rec.baselines as Record<string, unknown> | undefined)?.[p]
    if (rawBaseline !== undefined && rawBaseline !== null) {
      state.baselines[p] = sanitizeBaseline(rawBaseline)
    }
  }
  return state
}

function saveState(): void {
  const file = storageFile()
  if (!file) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    const payload = JSON.stringify({
      version: 1,
      current: state.current,
      history: state.history,
      baselines: state.baselines
    } satisfies RoundsFile)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, payload, 'utf-8')
    renameSync(tmp, file)
  } catch {
    // 持久化失败不影响运行
  }
}

// ---------- 状态机 ----------

let state: RoundsState = emptyState()
let initialized = false
/** 'boot':尚未消费自举 session 报告(重启恢复的第一份 quota 采样在此阶段处理) */
let phase: 'boot' | 'ready' = 'boot'
let bootReport: SessionReport | null | undefined
/** 重启跨边界的 provider:下一份成功报告只重建 baseline,离线 delta 不归入任何轮 */
const rebuildPending = new Set<TrackedQuotaProvider>()
/** resetsAt 稳定性确认(运行期状态,不持久化):同一非空值连续观测 ≥2 次后启用 period-reset 信号 */
const resetsConfirmations = new Map<TrackedQuotaProvider, { value: string; seen: number }>()

let queued: Promise<void> = Promise.resolve()
let listener: ((view: RoundsView) => void) | null = null

function enqueue(op: () => Promise<void>): Promise<void> {
  const run = queued.then(op, op)
  queued = run.catch(() => undefined)
  return run
}

export interface RoundsDeps {
  /** 取一份 ccusage session 报告(内部复用 getSessions 单飞);失败返回 null */
  fetchSessionReport: () => Promise<SessionReport | null>
  /**
   * 自举报告延迟启动的毫秒数(默认 30_000):启动期渲染层会立刻触发一次 daily 刷新,
   * 延迟让它先占用 ccusage FIFO,避免首屏被最长 1-2 分钟的 session 调用卡住。
   * 测试传 0 关闭延迟。
   */
  bootFetchDelayMs?: number
}

const DEFAULT_BOOT_DELAY_MS = 30_000

let deps: RoundsDeps | null = null

/**
 * 启动:加载持久化状态,并把"自举 session 报告"排进队首。
 * 报告本身延迟到第一份 quota 采样处理完之后消费,让重启恢复的边界判定先行;
 * 若首采样先到(phase 已翻转),则到达后按普通结算(尊重 rebuildPending)。
 */
export function initRounds(d: RoundsDeps): void {
  if (initialized) return
  deps = d
  state = loadState()
  phase = 'boot'
  bootReport = undefined
  rebuildPending.clear()
  resetsConfirmations.clear()
  initialized = true
  const delayMs = d.bootFetchDelayMs ?? DEFAULT_BOOT_DELAY_MS
  void enqueue(async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    const report = deps ? await deps.fetchSessionReport().catch(() => null) : null
    if (!report) return
    if (phase === 'ready') {
      settleReportWithRebuild(report)
      saveState()
      broadcast()
    } else {
      bootReport = report
    }
  })
}

export function setRoundsListener(fn: ((view: RoundsView) => void) | null): void {
  listener = fn
}

export function getRoundsView(): RoundsView {
  const providers = {} as RoundsView['providers']
  for (const p of TRACKED_PROVIDERS) {
    const hist = state.history[p]
    providers[p] = {
      current: state.current[p],
      previous: hist.length > 0 ? hist[hist.length - 1] : null,
      history: [...hist],
      sampling: state.baselines[p] === null
    }
  }
  return { generatedAt: new Date().toISOString(), providers }
}

function broadcast(): void {
  if (listener) listener(getRoundsView())
}

function isResetsStable(provider: TrackedQuotaProvider): boolean {
  const entry = resetsConfirmations.get(provider)
  return entry !== undefined && entry.seen >= 2
}

function observeResets(provider: TrackedQuotaProvider, value: string | null): void {
  if (value === null) {
    resetsConfirmations.delete(provider)
    return
  }
  const entry = resetsConfirmations.get(provider)
  if (entry && entry.value === value) entry.seen += 1
  else resetsConfirmations.set(provider, { value, seen: 1 })
}

function newCurrent(
  sample: PrimaryQuotaSample,
  estimated: boolean,
  reason: EstimatedReason | null
): CurrentRound {
  return {
    provider: sample.provider,
    remoteUserId: sample.remoteUserId,
    startAt: sample.observedAt,
    startPercent: sample.usedPercent,
    lastPercent: sample.usedPercent,
    lastResetsAt: sample.resetsAt,
    lastObservedAt: sample.observedAt,
    tokens: zeroUsage(),
    exhausted: sample.usedPercent >= EXHAUSTED_WATERMARK,
    estimated,
    estimatedReason: estimated ? reason : null
  }
}

function updateCurrent(current: CurrentRound, sample: PrimaryQuotaSample): void {
  current.lastPercent = sample.usedPercent
  // 只用非空值覆盖:last-known-good 保留,resetsAt 缺失时禁日期运算即可
  if (sample.resetsAt !== null) current.lastResetsAt = sample.resetsAt
  current.lastObservedAt = sample.observedAt
  current.exhausted = sample.usedPercent >= EXHAUSTED_WATERMARK
  // 身份暂时变 null 不覆盖;两个非空身份不同已在 detectBoundary 里按切号关闭
  if (current.remoteUserId === null && sample.remoteUserId !== null) {
    current.remoteUserId = sample.remoteUserId
  }
}

/** ISO 时间取较大者,保证 endAt >= startAt(时钟回拨容忍) */
function laterIso(a: string, b: string): string {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta)) return b
  if (!Number.isFinite(tb)) return a
  return tb >= ta ? b : a
}

function closeRoundIntoHistory(
  current: CurrentRound,
  observedAt: string,
  reason: QuotaRoundBoundaryReason,
  offlineBoundary: boolean
): QuotaRound {
  const round: QuotaRound = {
    provider: current.provider,
    remoteUserId: current.remoteUserId,
    startAt: current.startAt,
    endAt: laterIso(current.startAt, observedAt),
    startPercent: current.startPercent,
    endPercent: current.lastPercent,
    consumedPercent: Math.max(0, current.lastPercent - current.startPercent),
    tokens: current.tokens,
    exhausted: current.exhausted || current.lastPercent >= EXHAUSTED_WATERMARK,
    boundaryReason: reason,
    // 在线关闭保留原 estimated;离线跨边界时旧轮结尾同样不确定,强制标记
    estimated: offlineBoundary ? true : current.estimated,
    estimatedReason: offlineBoundary ? 'offline-boundary' : current.estimatedReason,
    closedAt: new Date().toISOString()
  }
  const hist = state.history[current.provider]
  hist.push(round)
  if (hist.length > HISTORY_LIMIT) hist.splice(0, hist.length - HISTORY_LIMIT)
  return round
}

function applyProviderTotal(
  provider: TrackedQuotaProvider,
  total: TokenUsage,
  generatedAt: string,
  opts?: { rebuildOnly?: boolean }
): void {
  const baseline = state.baselines[provider]
  // 复用的报告已被消费过(以 generatedAt 判重),跳过
  if (baseline && generatedAt <= baseline.sampledAt) return
  if (opts?.rebuildOnly || !baseline) {
    // 没有 baseline 时只建立 baseline,本次 delta 为 0;baseline 即使全 0 也保存
    state.baselines[provider] = { usage: { ...total }, sampledAt: generatedAt }
    return
  }
  const delta = usageDelta(total, baseline.usage)
  // baseline 无条件推进到最新累计值(含回落),避免长期卡住
  state.baselines[provider] = { usage: { ...total }, sampledAt: generatedAt }
  const current = state.current[provider]
  if (current) addUsage(current.tokens, delta)
  // 没有 current:只更新 baseline,不保留悬空 delta
}

async function safeFetchReport(): Promise<SessionReport | null> {
  if (!deps) return null
  try {
    return await deps.fetchSessionReport()
  } catch {
    return null
  }
}

/**
 * 边界处理(在线 §7.4 / 重启 §8.2 共用骨架):
 * 关旧轮(保留原 estimated)→ 开新轮(在线 estimated=false;重启 estimated=true)
 * → 本次取得的报告按需结算(rebuildOnly 时离线 delta 丢弃,仅重建 baseline)。
 */
async function handleBoundary(
  current: CurrentRound,
  sample: PrimaryQuotaSample,
  reason: QuotaRoundBoundaryReason,
  offline: boolean
): Promise<void> {
  const provider = current.provider
  if (offline) rebuildPending.add(provider)
  const report = await safeFetchReport()
  closeRoundIntoHistory(current, sample.observedAt, reason, offline)
  state.current[provider] = newCurrent(sample, offline, 'offline-boundary')
  if (report) {
    const total = providerTotalsFromReport(report).get(provider) ?? zeroUsage()
    applyProviderTotal(provider, total, report.generatedAt, { rebuildOnly: offline })
    rebuildPending.delete(provider)
  }
  saveState()
  broadcast()
}

/** 报告结算(rebuildPending 优先:离线跨边界的 provider 只重建 baseline) */
function settleReportWithRebuild(report: SessionReport): void {
  const totals = providerTotalsFromReport(report)
  for (const p of TRACKED_PROVIDERS) {
    if (rebuildPending.has(p)) {
      // 离线跨边界且边界时没拿到报告:这份报告只用于重建 baseline
      const total = totals.get(p) ?? zeroUsage()
      state.baselines[p] = { usage: { ...total }, sampledAt: report.generatedAt }
      rebuildPending.delete(p)
      continue
    }
    applyProviderTotal(p, totals.get(p) ?? zeroUsage(), report.generatedAt)
  }
}

/** 自举报告消费:首启建 baseline;重启无边界归增量;重启有边界只重建 baseline */
function consumeBootReport(): void {
  if (bootReport === undefined || bootReport === null) return
  const report = bootReport
  bootReport = null
  settleReportWithRebuild(report)
}

async function processQuota(snapshot: QuotaSnapshot | null): Promise<void> {
  const samples = extractSamples(snapshot)
  let structural = false
  for (const provider of TRACKED_PROVIDERS) {
    const sample = samples.get(provider)
    if (!sample) continue
    const current = state.current[provider]
    if (!current) {
      // 首次接入:百分比起点和 token baseline 并非同一瞬间采集 → estimated
      state.current[provider] = newCurrent(sample, true, 'bootstrap')
      structural = true
    } else {
      const stable = isResetsStable(provider)
      const boundary = detectBoundary(current, sample, stable)
      if (boundary) {
        // 第一份 quota 采样(重启恢复)遇到的边界按离线跨边界处理
        await handleBoundary(current, sample, boundary, phase === 'boot')
        structural = true
      } else {
        updateCurrent(current, sample)
      }
    }
    observeResets(provider, sample.resetsAt)
  }
  if (phase === 'boot') {
    consumeBootReport()
    phase = 'ready'
    structural = true
  }
  // 普通 120s 百分比更新不强制写盘;结构性变化立即落盘
  if (structural) saveState()
  broadcast()
}

async function processSessions(report: SessionReport): Promise<void> {
  const totals = providerTotalsFromReport(report)
  for (const p of TRACKED_PROVIDERS) {
    applyProviderTotal(p, totals.get(p) ?? zeroUsage(), report.generatedAt)
  }
  saveState()
  broadcast()
}

/** quota 服务每次 120s 轮询后调用;快照为 null 或没有合格账号时整次跳过 */
export function ingestQuota(snapshot: QuotaSnapshot | null): Promise<void> {
  if (!initialized) initRounds({ fetchSessionReport: async () => null })
  return enqueue(() => processQuota(snapshot))
}

/** 每次 session 报告(定时采样/Sessions 页/边界附带)都从这里进状态机;判重防重复消费 */
export function ingestSessions(report: SessionReport | null): Promise<void> {
  if (!initialized) initRounds({ fetchSessionReport: async () => null })
  return enqueue(async () => {
    if (report) await processSessions(report)
  })
}

/** before-quit:把当前内存态收尾写盘 */
export function flushRounds(): Promise<void> {
  return enqueue(async () => saveState())
}
