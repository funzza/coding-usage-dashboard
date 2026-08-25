/**
 * Quota 账号配置:持久化到 userData/quota-config.json。
 *
 * - 每个 provider 有一个内置 local 账号(id = local:<provider>),默认启用
 * - API 型 provider 可加 manual 账号:token 用 safeStorage(DPAPI)加密后落盘,
 *   明文只在 addManualAccount 与采集时短暂存在于主进程内存
 * - safeStorage 不可用时拒绝新增 manual 账号(绝不明文落盘)
 */
import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { QuotaAccountConfig, QuotaAccountConfigView, QuotaProviderId } from './types'

interface ConfigFile {
  version: 1
  accounts: QuotaAccountConfig[]
}

let accounts: QuotaAccountConfig[] | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'quota-config.json')
}

/**
 * 内置 local 账号槽位:每个 provider 一个 Windows 槽(id = local:<provider>);
 * kimi 额外有一个 WSL 槽(id = local-wsl:kimi,读 WSL 内凭据)。
 * enabled 缺省 true(向后兼容:老文件没有 enabled 字段视为启用)。
 */
export function defaultAccounts(providerIds: readonly QuotaProviderId[]): QuotaAccountConfig[] {
  const result: QuotaAccountConfig[] = providerIds.map((id) => ({
    id: `local:${id}`,
    provider: id,
    source: 'local',
    label: '',
    enabled: true
  }))
  if (providerIds.includes('kimi')) {
    result.push({
      id: 'local-wsl:kimi',
      provider: 'kimi',
      source: 'local',
      origin: 'wsl',
      label: 'WSL',
      enabled: true
    })
  }
  return result
}

/** 合并持久化配置与内置默认:缺失的内置槽位按 id 自动补齐,未知 id 的 manual 账号保留 */
export function mergeWithDefaults(
  stored: QuotaAccountConfig[],
  providerIds: readonly QuotaProviderId[]
): QuotaAccountConfig[] {
  const result = stored.filter(
    (a) =>
      typeof a.id === 'string' &&
      providerIds.includes(a.provider) &&
      (a.source === 'local' || a.source === 'manual')
  )
  for (const def of defaultAccounts(providerIds)) {
    if (!result.some((a) => a.id === def.id)) {
      result.push({ ...def })
    }
  }
  for (const a of result) {
    if (typeof a.enabled !== 'boolean') a.enabled = true
  }
  return result
}

function load(providerIds: readonly QuotaProviderId[]): QuotaAccountConfig[] {
  if (accounts) return accounts
  let stored: QuotaAccountConfig[] = []
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf-8')) as Partial<ConfigFile>
    if (Array.isArray(raw.accounts)) stored = raw.accounts
  } catch {
    // 文件不存在或损坏:用默认
  }
  accounts = mergeWithDefaults(stored, providerIds)
  save()
  return accounts
}

function save(): void {
  if (!accounts) return
  try {
    const file = configPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ version: 1, accounts } satisfies ConfigFile), 'utf-8')
  } catch {
    // 持久化失败不影响本次运行
  }
}

export function getAccounts(providerIds: readonly QuotaProviderId[]): QuotaAccountConfig[] {
  return load(providerIds)
}

/** IPC 视图:剥离 tokenEnc */
export function getAccountViews(providerIds: readonly QuotaProviderId[]): QuotaAccountConfigView[] {
  return load(providerIds).map(({ tokenEnc: _tokenEnc, ...view }) => view)
}

export function setAccountEnabled(
  providerIds: readonly QuotaProviderId[],
  accountId: string,
  enabled: boolean
): boolean {
  const account = load(providerIds).find((a) => a.id === accountId)
  if (!account) return false
  account.enabled = enabled
  save()
  return true
}

/** 新增 manual 账号;token 立即加密。safeStorage 不可用时抛错(拒绝明文落盘) */
export function addManualAccount(
  providerIds: readonly QuotaProviderId[],
  provider: QuotaProviderId,
  label: string,
  token: string
): QuotaAccountConfig {
  if (!providerIds.includes(provider)) throw new Error(`Unknown provider: ${provider}`)
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable on this system')
  }
  const trimmed = token.trim()
  if (trimmed === '') throw new Error('Token is empty')
  const account: QuotaAccountConfig = {
    id: `manual:${provider}:${randomUUID()}`,
    provider,
    source: 'manual',
    label: label.trim(),
    enabled: true,
    tokenEnc: safeStorage.encryptString(trimmed).toString('base64')
  }
  load(providerIds).push(account)
  save()
  return account
}

export function removeAccount(
  providerIds: readonly QuotaProviderId[],
  accountId: string
): boolean {
  const list = load(providerIds)
  const index = list.findIndex((a) => a.id === accountId && a.source === 'manual')
  if (index < 0) return false
  list.splice(index, 1)
  save()
  return true
}

/** 解密 manual 账号 token;失败视为凭据缺失 */
export function decryptToken(account: QuotaAccountConfig): string | null {
  if (account.source !== 'manual' || !account.tokenEnc) return null
  try {
    return safeStorage.decryptString(Buffer.from(account.tokenEnc, 'base64'))
  } catch {
    return null
  }
}
