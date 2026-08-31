/**
 * Quota(订阅额度)的 Normalized Model 与账号配置。
 *
 * 模型分两层:
 * - QuotaAccountConfig:用户配置(开关、多账号),持久化在 userData/quota-config.json;
 *   manual 账号的 token 用 safeStorage 加密存储,IPC 与 snapshot 永不带明文
 * - QuotaAccount:采集结果(每个账号一份),renderer 只消费它
 *
 * 安全红线:token 只在主进程内存/加密落盘;日志与错误信息一律脱敏。
 * 解析按"字段可能缺失"设计:上游 schema 漂移时降级为 null/空数组,不抛异常。
 */
import type { UsageOrigin } from '../../shared/agents'
import type { TokenUsage } from '../../shared/usage-model'

export type QuotaProviderId = 'kimi' | 'codex' | 'opencode-go' | 'grok' | 'cursor'

/** 单个限额窗口(5h / 周 / 月,窗口集合由各家数据动态决定,不硬编码) */
export interface QuotaWindow {
  key: string
  label: string
  /** 0–100;上游只给整数百分比,无绝对量时不做臆造 */
  usedPercent: number
  /** ISO8601;缺失时 UI 不显示倒计时 */
  resetsAt: string | null
}

export type QuotaStatus =
  /** 成功拿到实时数据 */
  | 'ok'
  /** 有凭据但本次请求失败;windows 保留最近一次成功数据 */
  | 'error'
  /** 未检测到凭据/未登录(Overview 不展示,Settings 里列为 Not detected) */
  | 'unavailable'

// ---------- 账号配置(持久化) ----------

export type QuotaCredentialSource = 'local' | 'manual'

/** 传给 provider.collect 的凭据:local = provider 自己读本机文件;manual = 解密后的 token */
export type QuotaCredential = { source: 'local' } | { source: 'manual'; token: string }

/** 一个账号实例的持久化配置;local 账号每个 provider 一个(WSL 变体另计),manual 可加多个 */
export interface QuotaAccountConfig {
  /** 'local:<provider>' / 'local-wsl:<provider>'(WSL 变体)或 'manual:<provider>:<uuid>' */
  id: string
  provider: QuotaProviderId
  source: QuotaCredentialSource
  /** 凭据所在环境;缺省 windows */
  origin?: UsageOrigin
  /** 用户可读的账号名(两个 Grok 账号靠它区分) */
  label: string
  enabled: boolean
  /** 仅 manual:safeStorage 加密后的 base64;解密只在主进程采集时进行 */
  tokenEnc?: string
}

/** 通过 IPC 暴露给 renderer 的配置视图:绝不包含 tokenEnc */
export interface QuotaAccountConfigView {
  id: string
  provider: QuotaProviderId
  source: QuotaCredentialSource
  origin?: UsageOrigin
  label: string
  enabled: boolean
}

// ---------- 采集结果 ----------

export interface QuotaAccount {
  accountId: string
  provider: QuotaProviderId
  /** 关联 usage snapshot 里的 agent id,用于交叉视图 */
  agent: string
  /** 凭据所在环境;与 usage 侧 origin 口径一致,前端据此渲染 (WSL) 徽标 */
  origin?: UsageOrigin
  /** provider 名(如 Grok) */
  displayName: string
  /** 账号名(默认 = displayName;多账号时由用户区分) */
  label: string
  source: QuotaCredentialSource
  /** 订阅档位(如 Allegretto / plus / SuperGrok),拿不到为 null */
  plan: string | null
  /** 远端账号身份(userId / account_id);拿不到为 null */
  remoteUserId: string | null
  status: QuotaStatus
  windows: QuotaWindow[]
  /** 附加信息(credits 余额等),纯展示 */
  extras: Array<{ label: string; value: string }>
  /** 最近一次成功获取时间;从未成功为 null */
  updatedAt: string | null
  /** 脱敏后的错误描述,可直接展示 */
  error: string | null
}

export interface QuotaSnapshot {
  generatedAt: string
  accounts: QuotaAccount[]
}

// ---------- 轮次用量(Round) ----------

/** 参与轮次状态机的 provider(不监控 opencode-go) */
export type TrackedQuotaProvider = 'kimi' | 'codex' | 'grok'

export type QuotaRoundBoundaryReason = 'period-reset' | 'account-switch' | 'percent-rollback'

/** estimated 的成因:首次接入 / 离线跨边界;仅供 tooltip 区分,语义仍以 estimated 为准 */
export type EstimatedReason = 'bootstrap' | 'offline-boundary'

export interface QuotaRound {
  provider: TrackedQuotaProvider
  remoteUserId: string | null
  startAt: string
  endAt: string
  startPercent: number
  endPercent: number
  consumedPercent: number
  tokens: TokenUsage
  exhausted: boolean
  boundaryReason: QuotaRoundBoundaryReason
  /** 仅首次接入或离线跨边界造成实质性不确定时为 true */
  estimated: boolean
  estimatedReason: EstimatedReason | null
  closedAt: string
}

export interface CurrentRound {
  provider: TrackedQuotaProvider
  remoteUserId: string | null
  startAt: string
  startPercent: number
  lastPercent: number
  lastResetsAt: string | null
  lastObservedAt: string
  tokens: TokenUsage
  exhausted: boolean
  /** 仅首次接入或离线跨边界造成实质性不确定时为 true */
  estimated: boolean
  estimatedReason: EstimatedReason | null
}

/** 某 provider 在最近一次成功 session 报告中的累计总量 */
export interface ProviderTokenBaseline {
  usage: TokenUsage
  sampledAt: string
}

export interface RoundsView {
  generatedAt: string
  providers: Record<
    TrackedQuotaProvider,
    {
      current: CurrentRound | null
      previous: QuotaRound | null
      history: QuotaRound[]
      /** token baseline 尚未建立(UI 显示"采集中",而不是 0 tokens) */
      sampling: boolean
    }
  >
}
