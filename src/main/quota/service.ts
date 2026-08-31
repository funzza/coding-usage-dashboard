/**
 * Quota 采集服务:按"账号"并行采集、单飞守卫、单账号失败保留旧数据。
 *
 * 账号模型:每个 provider 一个内置 local 账号,API 型 provider 可加 manual 账号
 * (多开,例如两个 Grok 账号);配置见 config.ts,凭据明文不出主进程。
 *
 * 与 ccusage 刷新不同:这些是轻量 GET(秒级),默认 120s 轮询一次。
 */
import { collectCodexQuota, codexCredentialExists } from './codex'
import { collectCursorQuota, cursorCredentialExists } from './cursor'
import {
  addManualAccount as configAddManualAccount,
  decryptToken,
  getAccounts,
  getAccountViews,
  removeAccount as configRemoveAccount,
  setAccountEnabled as configSetAccountEnabled
} from './config'
import { collectGrokQuota, grokCredentialExists } from './grok'
import { toDisplayError } from './http'
import { collectKimiQuota, disposeKimiSidecar, kimiCredentialExists } from './kimi'
import { collectOpencodeGoQuota, opencodeGoCredentialExists } from './opencode-go'
import { flushRounds, ingestQuota, ingestSessions, initRounds, SESSION_SAMPLE_INTERVAL_MS } from './rounds'
import { getSessions } from '../usage/service'
import type { UsageOrigin } from '../../shared/agents'
import type {
  QuotaAccount,
  QuotaAccountConfig,
  QuotaAccountConfigView,
  QuotaCredential,
  QuotaProviderId,
  QuotaSnapshot
} from './types'

const POLL_INTERVAL_MS = 120_000

interface ProviderDef {
  id: QuotaProviderId
  agent: string
  displayName: string
  /** 是否支持粘贴 token 的多账号(Kimi 走本地服务代理,无此能力) */
  supportsManual: boolean
  /** 按环境检查本机/WSL 凭据是否存在;kimi 的 WSL 侧是异步发现(UNC) */
  localCredentialExists: (origin?: UsageOrigin) => boolean | Promise<boolean>
  collect: (cred: QuotaCredential, origin?: UsageOrigin) => Promise<{
    windows: QuotaAccount['windows']
    extras?: QuotaAccount['extras']
    plan?: string | null
    remoteUserId?: string | null
  }>
}

const PROVIDERS: ProviderDef[] = [
  { id: 'kimi', agent: 'kimi', displayName: 'Kimi', supportsManual: false, localCredentialExists: kimiCredentialExists, collect: (_cred, origin) => collectKimiQuota(origin) },
  { id: 'codex', agent: 'codex', displayName: 'ChatGPT', supportsManual: true, localCredentialExists: codexCredentialExists, collect: (cred) => collectCodexQuota(cred) },
  { id: 'opencode-go', agent: 'opencode', displayName: 'OpenCode Go', supportsManual: true, localCredentialExists: opencodeGoCredentialExists, collect: (cred) => collectOpencodeGoQuota(cred) },
  { id: 'grok', agent: 'grok', displayName: 'Grok', supportsManual: true, localCredentialExists: grokCredentialExists, collect: (cred) => collectGrokQuota(cred) },
  { id: 'cursor', agent: 'cursor', displayName: 'Cursor', supportsManual: false, localCredentialExists: cursorCredentialExists, collect: (cred) => collectCursorQuota(cred) }
]

const PROVIDER_IDS = PROVIDERS.map((p) => p.id)

let snapshot: QuotaSnapshot | null = null
let inFlight: Promise<QuotaSnapshot> | null = null
let listener: ((snapshot: QuotaSnapshot) => void) | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let sessionTimer: ReturnType<typeof setInterval> | null = null

function providerDef(id: QuotaProviderId): ProviderDef {
  return PROVIDERS.find((p) => p.id === id)!
}

/** 账号的展示名:用户起的 label 优先,否则 provider 名 */
export function accountLabel(account: QuotaAccountConfig): string {
  return account.label || providerDef(account.provider).displayName
}

async function resolveCredential(account: QuotaAccountConfig): Promise<QuotaCredential | null> {
  if (account.source === 'local') {
    const exists = await providerDef(account.provider).localCredentialExists(account.origin)
    return exists ? { source: 'local' } : null
  }
  const token = decryptToken(account)
  return token ? { source: 'manual', token } : null
}

async function collectAccount(
  account: QuotaAccountConfig,
  prev: QuotaAccount | undefined
): Promise<QuotaAccount> {
  const def = providerDef(account.provider)
  const base: QuotaAccount = {
    accountId: account.id,
    provider: account.provider,
    agent: def.agent,
    origin: account.origin,
    displayName: def.displayName,
    label: accountLabel(account),
    source: account.source,
    plan: prev?.plan ?? null,
    remoteUserId: prev?.remoteUserId ?? null,
    status: 'unavailable',
    windows: prev?.windows ?? [],
    extras: prev?.extras ?? [],
    updatedAt: prev?.updatedAt ?? null,
    error: null
  }
  const cred = await resolveCredential(account)
  if (!cred) {
    if (account.source === 'manual') {
      return { ...base, status: 'error', error: 'Stored credential is unreadable' }
    }
    return base
  }
  try {
    const result = await def.collect(cred, account.origin)
    return {
      ...base,
      plan: result.plan ?? base.plan,
      remoteUserId: result.remoteUserId ?? base.remoteUserId,
      status: 'ok',
      windows: result.windows,
      extras: result.extras ?? [],
      updatedAt: new Date().toISOString(),
      error: null
    }
  } catch (err) {
    // 失败保留最近一次成功数据,只更新状态与错误描述
    return { ...base, status: 'error', error: toDisplayError(err) }
  }
}

async function doRefresh(): Promise<QuotaSnapshot> {
  const prev = snapshot
  // 只采集启用的账号;禁用的从快照里消失(Settings 里仍可见配置)
  const enabled = getAccounts(PROVIDER_IDS).filter((a) => a.enabled)
  const accounts = await Promise.all(
    enabled.map((a) =>
      collectAccount(a, prev?.accounts.find((p) => p.accountId === a.id))
    )
  )
  snapshot = { generatedAt: new Date().toISOString(), accounts }
  listener?.(snapshot)
  // 轮次状态机消费本份快照(内部经队列串行,不阻塞采集)
  void ingestQuota(snapshot)
  return snapshot
}

/** 手动刷新;进行中的调用直接复用(单飞) */
export function refreshQuota(): Promise<QuotaSnapshot> {
  if (!inFlight) {
    inFlight = doRefresh().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

export function getQuotaSnapshot(): QuotaSnapshot | null {
  return snapshot
}

export function setQuotaListener(fn: (snapshot: QuotaSnapshot) => void): void {
  listener = fn
}

// ---------- 账号管理(IPC 用;配置变更后立刻重采,让 UI 马上反映) ----------

export function getQuotaAccountViews(): QuotaAccountConfigView[] {
  return getAccountViews(PROVIDER_IDS)
}

export function providerSupportsManual(provider: QuotaProviderId): boolean {
  return providerDef(provider).supportsManual
}

export async function setQuotaAccountEnabled(accountId: string, enabled: boolean): Promise<void> {
  configSetAccountEnabled(PROVIDER_IDS, accountId, enabled)
  await refreshQuota()
}

/**
 * 新增 manual 账号:先用该 token 试采一次,失败则不保存。
 * 返回 QuotaAccount 让 UI 立即展示首采结果。
 */
export async function addQuotaAccount(
  provider: QuotaProviderId,
  label: string,
  token: string
): Promise<QuotaAccount> {
  if (!providerSupportsManual(provider)) {
    throw new Error(`${providerDef(provider).displayName} uses the local CLI credential only`)
  }
  const def = providerDef(provider)
  // 先验证 token,通过才落盘
  const probe = await def.collect({ source: 'manual', token: token.trim() }).catch((err) => {
    throw new Error(toDisplayError(err))
  })
  const account = configAddManualAccount(PROVIDER_IDS, provider, label, token)
  const collected: QuotaAccount = {
    accountId: account.id,
    provider,
    agent: def.agent,
    displayName: def.displayName,
    label: accountLabel(account),
    source: 'manual',
    plan: probe.plan ?? null,
    remoteUserId: probe.remoteUserId ?? null,
    status: 'ok',
    windows: probe.windows,
    extras: probe.extras ?? [],
    updatedAt: new Date().toISOString(),
    error: null
  }
  snapshot = {
    generatedAt: new Date().toISOString(),
    accounts: [...(snapshot?.accounts ?? []), collected]
  }
  listener?.(snapshot)
  return collected
}

export async function removeQuotaAccount(accountId: string): Promise<void> {
  configRemoveAccount(PROVIDER_IDS, accountId)
  if (snapshot) {
    snapshot = {
      ...snapshot,
      accounts: snapshot.accounts.filter((a) => a.accountId !== accountId)
    }
    listener?.(snapshot)
  }
}

/** 应用启动后调用:立刻采一次(不阻塞 ready),之后 120s 轮询;并启动 5min session 采样 */
export function startQuotaPolling(): void {
  if (pollTimer) return
  // 轮次状态机:先加载持久化状态并把自举 session 报告排队(内部复用 getSessions 单飞)
  initRounds({ fetchSessionReport: () => getSessions().then((r) => r.report) })
  void refreshQuota()
  pollTimer = setInterval(() => {
    void refreshQuota()
  }, POLL_INTERVAL_MS)
  sessionTimer = setInterval(() => {
    void getSessions()
      .then((r) => ingestSessions(r.report))
      .catch(() => undefined)
  }, SESSION_SAMPLE_INTERVAL_MS)
}

/** before-quit:停轮询/session 采样,杀掉我们拉起的 kimi web sidecar,轮次状态收尾写盘 */
export function disposeQuota(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (sessionTimer) clearInterval(sessionTimer)
  sessionTimer = null
  disposeKimiSidecar()
  void flushRounds()
}
