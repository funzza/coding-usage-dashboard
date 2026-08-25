import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { localDateString } from '../../shared/usage-model'

/**
 * Qoder CN IDE 本地 usage 读取器。
 *
 * Qoder(v1.25.x,VSCode 系)把 token 明细存在
 * `%APPDATA%\QoderCN\SharedClientCache\cache\db\local.db` 的 chat_message 表:
 * 每条 assistant 消息 = 一次 LLM 调用,token_info / model_info 是 TEXT 内嵌 JSON。
 * 没有官方导出命令,只能直连数据库——fail-soft,绝不影响 ccusage 主链路。
 *
 * 已实测(2026-08,本机 102MB 库,1245/1245 条 assistant 消息全覆盖):
 * - token_info: { prompt_tokens, completion_tokens, cached_tokens, max_input_tokens }
 *   prompt_tokens **包含** cached_tokens(OpenAI 语义;全量 0 违例,勿把 cached 再加一遍)
 * - model_info.model_key 只是档位(custom_model / qmodel_preview / ...),真实模型名两跳:
 *   chat_session.preferred_model_info("custom:<id>") → state.vscdb 的 aicoding.customModels
 * - gmt_create 为 UTC 毫秒 epoch;按本地日期分桶,与 ccusage 一致
 * - 已删除的 BYOK 模型无法再从 customModels 解析,调用方可传 cachePath 持久化 id→名字映射
 */

/** 日×模型聚合行;token 为原始求和值(promptTokens 含 cachedTokens) */
export interface QoderDailyModelRow {
  day: string
  model: string
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  requests: number
}

const MESSAGE_COLUMNS = ['session_id', 'token_info', 'model_info', 'gmt_create'] as const
const SESSION_COLUMNS = ['session_id', 'preferred_model_info'] as const

const MESSAGE_SQL = `
  SELECT m.token_info AS tokenInfo,
         m.model_info AS modelInfo,
         m.gmt_create AS createdAt,
         s.preferred_model_info AS preferredModelInfo
  FROM chat_message m
  LEFT JOIN chat_session s ON s.session_id = m.session_id
  WHERE m.role = 'assistant' AND m.token_info IS NOT NULL
`

function appDataDir(): string {
  return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
}

export function qoderDbPath(): string {
  return join(appDataDir(), 'QoderCN', 'SharedClientCache', 'cache', 'db', 'local.db')
}

export function qoderStateDbPath(): string {
  return join(appDataDir(), 'QoderCN', 'User', 'globalStorage', 'state.vscdb')
}

/** 只读打开;WAL 直开失败时复制 db(+wal/shm)到临时目录再读(与 zcode 同一策略) */
function openReadOnly(dbPath: string): DatabaseSync {
  try {
    return new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    const dir = mkdtempSync(join(tmpdir(), 'qoder-db-'))
    const copy = join(dir, 'local.db')
    copyFileSync(dbPath, copy)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, copy + suffix)
    }
    return new DatabaseSync(copy, { readOnly: true })
  }
}

function hasColumns(db: DatabaseSync, table: string, required: readonly string[]): boolean {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
  )
  return required.every((c) => cols.has(c))
}

function safeParse(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** state.vscdb → aicoding.customModels:id → 显示名(displayName 优先,model 兜底);失败返回空表 */
function loadCustomModelNames(vscdbPath: string): Map<string, string> {
  const names = new Map<string, string>()
  if (!existsSync(vscdbPath)) return names
  let db: DatabaseSync | null = null
  try {
    db = openReadOnly(vscdbPath)
    const row = db.prepare(`SELECT value FROM ItemTable WHERE key = 'aicoding.customModels'`).get() as
      | { value: unknown }
      | undefined
    const list: unknown = safeParse(row?.value)
    if (Array.isArray(list)) {
      for (const entry of list as Array<Record<string, unknown>>) {
        if (typeof entry?.id !== 'string') continue
        const name =
          (typeof entry.displayName === 'string' && entry.displayName) ||
          (typeof entry.model === 'string' && entry.model) ||
          null
        if (name) names.set(entry.id, name)
      }
    }
  } catch {
    // vscdb 读取失败:custom 模型退化为原始 id,不影响主流程
  } finally {
    try {
      db?.close()
    } catch {
      /* 关闭失败无碍 */
    }
  }
  return names
}

/** 读取 id→名字持久化缓存(已删除的 BYOK 模型只能靠它解析) */
function readNameCache(cachePath: string | undefined): Map<string, string> {
  const names = new Map<string, string>()
  if (!cachePath) return names
  try {
    const raw = JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<string, unknown>
    for (const [id, name] of Object.entries(raw)) {
      if (typeof name === 'string' && name) names.set(id, name)
    }
  } catch {
    // 文件不存在或损坏:从空缓存开始
  }
  return names
}

function writeNameCache(cachePath: string | undefined, names: Map<string, string>): void {
  if (!cachePath || names.size === 0) return
  try {
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, JSON.stringify(Object.fromEntries(names)), 'utf-8')
  } catch {
    // 持久化失败不影响本次读取
  }
}

/**
 * 模型名解析:
 * - model_key 非 custom_model:直接用档位名(qmodel_preview / dfmodel / ...)
 * - custom_model / 缺失:session 的 preferred_model;custom:<id> 经 customModels(+缓存)解析,
 *   解析不回时保留原始 id(区分不同的已删模型)
 */
function resolveModel(
  modelInfo: Record<string, unknown> | null,
  preferredModelInfo: Record<string, unknown> | null,
  customNames: Map<string, string>
): string {
  const modelKey = typeof modelInfo?.model_key === 'string' ? modelInfo.model_key : null
  if (modelKey && modelKey !== 'custom_model') return modelKey
  const preferred = preferredModelInfo?.preferred_model
  if (typeof preferred === 'string' && preferred) {
    if (preferred.startsWith('custom:')) {
      const id = preferred.slice('custom:'.length)
      return customNames.get(id) ?? id
    }
    return preferred
  }
  return modelKey ?? 'unknown'
}

export interface QoderReadResult {
  rows: QoderDailyModelRow[] | null
  error?: string
}

/**
 * 读取 Qoder 全量日×模型聚合;db 不存在返回 { rows: null }(无 error),
 * schema 不符 / 读取失败返回 { rows: null, error }。
 * cachePath 可选:传入时把 customModels 的 id→名字映射持久化,供已删模型解析。
 */
export function loadQoderDailyRows(
  dbPath: string = qoderDbPath(),
  vscdbPath: string = qoderStateDbPath(),
  cachePath?: string
): QoderReadResult {
  if (!existsSync(dbPath)) return { rows: null }

  // custom 模型名表 = 当前 customModels ∪ 持久化缓存,并回写缓存
  const names = readNameCache(cachePath)
  for (const [id, name] of loadCustomModelNames(vscdbPath)) names.set(id, name)
  writeNameCache(cachePath, names)

  let db: DatabaseSync | null = null
  try {
    db = openReadOnly(dbPath)
    if (!hasColumns(db, 'chat_message', MESSAGE_COLUMNS) || !hasColumns(db, 'chat_session', SESSION_COLUMNS)) {
      const error = 'chat_message/chat_session schema changed (Qoder update?)'
      console.warn('[qoder]', error)
      return { rows: null, error }
    }
    const messages = db.prepare(MESSAGE_SQL).all() as Array<Record<string, unknown>>
    const byKey = new Map<string, QoderDailyModelRow>()
    for (const msg of messages) {
      const tokenInfo = safeParse(msg.tokenInfo)
      const createdAt = Number(msg.createdAt)
      if (!tokenInfo || !Number.isFinite(createdAt)) continue
      const day = localDateString(new Date(createdAt))
      const model = resolveModel(safeParse(msg.modelInfo), safeParse(msg.preferredModelInfo), names)
      const key = `${day}${model}`
      let row = byKey.get(key)
      if (!row) {
        row = { day, model, promptTokens: 0, completionTokens: 0, cachedTokens: 0, requests: 0 }
        byKey.set(key, row)
      }
      row.promptTokens += num(tokenInfo.prompt_tokens)
      row.completionTokens += num(tokenInfo.completion_tokens)
      row.cachedTokens += num(tokenInfo.cached_tokens)
      row.requests += 1
    }
    return { rows: [...byKey.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)) }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn('[qoder] failed to read db:', error)
    return { rows: null, error }
  } finally {
    try {
      db?.close()
    } catch {
      /* 关闭失败无碍 */
    }
  }
}
