/**
 * Cursor 用量 CSV → normalized DailyUsage[](agent 固定 'cursor')。
 *
 * CSV 列(2026-08-31 实测,strategy=tokens):
 *   Date, Cloud Agent ID, Automation ID, Kind, Model, Max Mode,
 *   Input (w/ Cache Write), Input (w/o Cache Write), Cache Read,
 *   Output Tokens, Total Tokens, Cost
 *
 * 语义映射(与列名自洽,已验证 Total = Input(w/o CW) + Input(w/ CW) + Cache Read + Output):
 * - inputTokens      = Input (w/o Cache Write)   —— 未写缓存的 prompt 部分
 * - cacheCreationTokens = Input (w/ Cache Write) —— 本次写入缓存的 prompt 部分
 * - cacheReadTokens  = Cache Read
 * - outputTokens     = Output Tokens
 * - totalTokens      = Total Tokens(上报值优先;与四项和冲突时用上报值,同 ccusage 口径)
 * - totalCost        = Cost 数值列;'Included'/'On demand' 等非数值按 0 计
 *
 * Date 为 UTC ISO,按本地时区落桶(localDateString),与 ccusage/zcode 口径一致。
 */
import { localDateString, rowsToDaily } from '../../shared/usage-model'
import type { DailyUsage, ModelUsage, UsageOrigin } from '../../shared/usage-model'

export const CURSOR_AGENT = 'cursor'

export interface CursorUsageRow {
  day: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  totalCost: number
}

const REQUIRED_COLUMNS = [
  'Date',
  'Model',
  'Input (w/ Cache Write)',
  'Input (w/o Cache Write)',
  'Cache Read',
  'Output Tokens',
  'Total Tokens',
  'Cost'
] as const

/** 标准 CSV 行解析:表头无引号、数据行全引号,兼容引号内逗号与转义引号 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

function num(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * CSV 文本 → 行(未按天聚合,逐事件一行,由 rowsToDaily 合并)。
 * 头部缺列 / 行字段数对不上时返回 null(schema 漂移,调用方标 skipped)。
 */
export function parseCursorUsageCsv(csv: string): CursorUsageRow[] | null {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length === 0) return null
  const header = parseCsvLine(lines[0])
  if (header.length === 0) return null
  const index = new Map(header.map((name, i) => [name, i]))
  if (!REQUIRED_COLUMNS.every((name) => index.has(name))) return null
  const col = (name: (typeof REQUIRED_COLUMNS)[number]): number => index.get(name)!

  const rows: CursorUsageRow[] = []
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue
    const f = parseCsvLine(line)
    if (f.length !== header.length) return null
    const dateRaw = f[col('Date')]
    const model = f[col('Model')]
    if (!dateRaw || !model) continue
    const day = localDateString(new Date(dateRaw))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const inputNoCacheWrite = num(f[col('Input (w/o Cache Write)')])
    const inputCacheWrite = num(f[col('Input (w/ Cache Write)')])
    const cacheRead = num(f[col('Cache Read')])
    const output = num(f[col('Output Tokens')])
    const total = num(f[col('Total Tokens')])
    const cost = Number(f[col('Cost')])
    const parts = inputNoCacheWrite + inputCacheWrite + cacheRead + output
    rows.push({
      day,
      model,
      inputTokens: inputNoCacheWrite,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: inputCacheWrite,
      totalTokens: total || parts,
      totalCost: Number.isFinite(cost) && cost > 0 ? cost : 0
    })
  }
  return rows
}

function toModel(row: CursorUsageRow): ModelUsage {
  return {
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    totalTokens: row.totalTokens,
    totalCost: row.totalCost
  }
}

/** Cursor 行 → normalized DailyUsage[](agent 'cursor',origin 标注来源环境) */
export function adaptCursorRows(rows: CursorUsageRow[], origin?: UsageOrigin): DailyUsage[] {
  return rowsToDaily(rows, CURSOR_AGENT, (r) => r.day, toModel, origin)
}
