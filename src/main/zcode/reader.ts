import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * zcode 本地 usage 读取器。
 *
 * zcode(0.16.x)把 usage 存在 SQLite:`~/.zcode/cli/db/db.sqlite` 的 model_usage 表
 * (每次 LLM API 请求一行)。没有官方导出命令,只能直连数据库——
 * 这是 ccusage 之外的独立数据源,读取失败必须 fail-soft(返回 null),绝不影响 ccusage 主链路。
 *
 * 已实测(2026-08,本机 144MB 库):
 * - db 为 WAL 模式,zcode 运行时只读直开可用;直开失败(如 -shm 缺失)回退为复制后读
 * - started_at 是 UTC 毫秒 epoch,SQL 侧用 'localtime' 转本地日期,与 ccusage 的本地分桶一致
 */

/** model_usage 聚合行:按本地日期 × 模型分组,token 为原始求和值(input 含 cache) */
export interface ZcodeDailyModelRow {
  day: string
  model: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
}

const REQUIRED_COLUMNS = [
  'started_at',
  'model_id',
  'input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'status'
] as const

const AGGREGATE_SQL = `
  SELECT date(started_at/1000, 'unixepoch', 'localtime') AS day,
         model_id AS model,
         SUM(input_tokens) AS inputTokens,
         SUM(output_tokens) AS outputTokens,
         SUM(reasoning_tokens) AS reasoningTokens,
         SUM(cache_read_input_tokens) AS cacheReadTokens,
         SUM(cache_creation_input_tokens) AS cacheCreationTokens,
         COUNT(*) AS requests
  FROM model_usage
  WHERE status = 'completed' AND started_at IS NOT NULL
  GROUP BY day, model
  ORDER BY day ASC
`

export function zcodeDbPath(): string {
  return join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite')
}

/**
 * 只读打开;WAL 直开失败时复制 db(+wal/shm)到临时目录再读。
 * 复制发生在 zcode 写入进行中时可能拿到不一致快照,但只用于统计展示,可接受。
 * UNC 路径(\\wsl.localhost\...,9P 网络文件系统)上 WAL 的 mmap/锁不可靠,
 * 直开必失败,跳过直开直接走复制分支。
 */
function openReadOnly(dbPath: string): { db: DatabaseSync; tempDir: string | null } {
  if (!dbPath.startsWith('\\\\')) {
    try {
      return { db: new DatabaseSync(dbPath, { readOnly: true }), tempDir: null }
    } catch {
      // 落到下方复制分支
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'zcode-db-'))
  try {
    const copy = join(dir, 'db.sqlite')
    copyFileSync(dbPath, copy)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, copy + suffix)
    }
    return { db: new DatabaseSync(copy, { readOnly: true }), tempDir: dir }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

/** schema 守卫:model_usage 缺关键列(上游大版本改表)时返回 false,由调用方放弃本数据源 */
function hasExpectedSchema(db: DatabaseSync): boolean {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(model_usage)').all() as Array<{ name: string }>).map((c) => c.name)
  )
  return REQUIRED_COLUMNS.every((c) => cols.has(c))
}

export interface ZcodeReadResult {
  rows: ZcodeDailyModelRow[] | null
  error?: string
}

/**
 * 读取 zcode 全量日×模型聚合;db 不存在返回 { rows: null }(无 error),
 * schema 不符 / 读取失败返回 { rows: null, error }。
 * 单次查询约几十毫秒,可以挂在每次 usage 刷新上。
 */
export function loadZcodeDailyRows(dbPath: string = zcodeDbPath()): ZcodeReadResult {
  if (!existsSync(dbPath)) return { rows: null }
  let db: DatabaseSync | null = null
  let tempDir: string | null = null
  try {
    ;({ db, tempDir } = openReadOnly(dbPath))
    if (!hasExpectedSchema(db)) {
      const error = 'model_usage schema changed (zcode update?)'
      console.warn('[zcode]', error)
      return { rows: null, error }
    }
    const rows = db.prepare(AGGREGATE_SQL).all() as Array<Record<string, number | string | null>>
    return {
      rows: rows.map((r) => ({
        day: String(r.day),
        model: typeof r.model === 'string' && r.model ? r.model : 'unknown',
        inputTokens: Number(r.inputTokens) || 0,
        outputTokens: Number(r.outputTokens) || 0,
        reasoningTokens: Number(r.reasoningTokens) || 0,
        cacheReadTokens: Number(r.cacheReadTokens) || 0,
        cacheCreationTokens: Number(r.cacheCreationTokens) || 0,
        requests: Number(r.requests) || 0
      }))
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn('[zcode] failed to read db:', error)
    return { rows: null, error }
  } finally {
    try {
      db?.close()
    } catch {
      /* 关闭失败无碍 */
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  }
}
