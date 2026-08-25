import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { localDateString } from '../../shared/usage-model'

/**
 * dsh(DeepSeek Harness,developer preview)本地 usage 读取器。
 *
 * dsh 没有 SQLite、没有官方导出命令;usage 以事件流存在
 * `~/.dsh/sessions/<cwd编码>/session-<uuid>/session.jsonl.zstd`:
 * - 多帧 zstd 拼接(帧魔数 28 B5 2F FD),逐帧解压后拼成 JSONL
 * - usage 事件:assistant/chunk 且 chunk.type === 'usage',每次 API 调用一条
 * - 模型名不在 usage 行上,取 seq 之前最近的 request/header 的 config.model
 *
 * 格式守卫:session 头行带 version 字段(当前为 0);dsh 处于 rc 阶段、格式可能变,
 * version 不符或解压失败时跳过该文件(fail-soft),绝不影响 ccusage 主链路。
 *
 * 性能:文件只会追加写,按 path+mtime+size 缓存每文件的聚合结果,未变的文件不重解析。
 */

/** dsh 聚合行:按本地日期 × 模型分组;input 不含 cache(已与官方 projcache 对账验证) */
export interface DshDailyModelRow {
  day: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  calls: number
}

/** 当前已知的 session 事件 schema 版本;将来 dsh 升 version 时整文件跳过 */
const KNOWN_SESSION_VERSION = 0

interface UsageEvent {
  time: number
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

/** 帧切分 + 逐帧解压;尾帧截断(写入进行中)时丢弃尾部保留已解压内容,中间帧损坏返回 null */
export function decompressFrames(raw: Buffer): string | null {
  const starts: number[] = []
  for (let i = 0; i + 3 < raw.length; i++) {
    if (raw[i] === 0x28 && raw[i + 1] === 0xb5 && raw[i + 2] === 0x2f && raw[i + 3] === 0xfd) {
      starts.push(i)
    }
  }
  if (starts.length === 0) return null
  starts.push(raw.length)

  const chunks: Buffer[] = []
  for (let i = 0; i < starts.length - 1; i++) {
    const slice = raw.subarray(starts[i], starts[i + 1])
    const chunk = tryDecompress(slice)
    if (!chunk) {
      if (i === starts.length - 2) break // 尾帧:容忍截断
      return null
    }
    chunks.push(chunk)
  }
  return chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null
}

function tryDecompress(slice: Buffer): Buffer | null {
  try {
    return zstdDecompressSync(slice)
  } catch {
    // 截断的尾帧:逐步回退到最近的可解压边界
    for (let end = slice.length - 1; end > 8; end--) {
      try {
        return zstdDecompressSync(slice.subarray(0, end))
      } catch {
        /* 继续回退 */
      }
    }
    return null
  }
}

/**
 * 解析单个会话文件内容 → usage 事件流(带模型归属)。
 * version 不符返回 null(由调用方记录);坏行逐行跳过。
 */
export function parseSessionEvents(text: string): { events: UsageEvent[]; versionOk: boolean } {
  let currentModel = 'unknown'
  let version: number | null = null
  const events: UsageEvent[] = []

  for (const line of text.split('\n')) {
    if (!line) continue
    let o: Record<string, unknown>
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o.type === 'session') {
      if (typeof o.version === 'number') version = o.version
      continue
    }
    if (o.type === 'request/header') {
      const model = (o.data as never as { header?: { config?: { model?: unknown } } })?.header?.config?.model
      if (typeof model === 'string' && model) currentModel = model
      continue
    }
    if (o.type === 'assistant/chunk') {
      const data = o.data as { chunk?: { type?: string; usage?: Record<string, unknown> } } | undefined
      if (data?.chunk?.type !== 'usage') continue
      const time = Number(o.time)
      if (!Number.isFinite(time)) continue
      const u = data.chunk.usage ?? {}
      events.push({
        time,
        model: currentModel,
        inputTokens: Number(u.inputTokens) || 0,
        outputTokens: Number(u.outputTokens) || 0,
        // cacheReadTokens 可能整键缺席,按 0 兜底
        cacheReadTokens: Number(u.cacheReadTokens) || 0
      })
    }
  }
  return { events, versionOk: version === null || version === KNOWN_SESSION_VERSION }
}

function aggregateEvents(events: UsageEvent[]): DshDailyModelRow[] {
  const byDayModel = new Map<string, DshDailyModelRow>()
  for (const e of events) {
    const day = localDateString(new Date(e.time))
    const key = `${day}|${e.model}`
    let row = byDayModel.get(key)
    if (!row) {
      row = {
        day,
        model: e.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        calls: 0
      }
      byDayModel.set(key, row)
    }
    row.inputTokens += e.inputTokens
    row.outputTokens += e.outputTokens
    row.cacheReadTokens += e.cacheReadTokens
    row.calls += 1
  }
  return [...byDayModel.values()]
}

function listSessionFiles(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name === 'session.jsonl.zstd') files.push(p)
    }
  }
  walk(root)
  return files
}

interface FileCacheEntry {
  mtimeMs: number
  size: number
  rows: DshDailyModelRow[]
}

/** 追加写文件的聚合缓存:未变化不重解压 */
const fileCache = new Map<string, FileCacheEntry>()

export function dshSessionsRoot(): string {
  return join(homedir(), '.dsh', 'sessions')
}

export interface DshReadResult {
  rows: DshDailyModelRow[]
  /** 因 version 不符/解压失败被跳过的文件数(>0 时调用方应告警) */
  skippedFiles: number
  totalFiles: number
}

/**
 * 扫描全部会话文件并聚合;sessions 目录不存在返回 null。
 * 单文件失败不拖垮整体(记入 skippedFiles)。
 */
export function loadDshDailyRows(root: string = dshSessionsRoot()): DshReadResult | null {
  if (!existsSync(root)) return null
  const files = listSessionFiles(root)
  const all: DshDailyModelRow[] = []
  let skippedFiles = 0

  for (const file of files) {
    const stat = statSync(file)
    const cached = fileCache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      all.push(...cached.rows)
      continue
    }

    let text: string | null = null
    try {
      text = decompressFrames(readFileSync(file))
    } catch {
      text = null
    }
    if (text === null) {
      console.warn('[dsh] decompress failed:', file)
      skippedFiles++
      continue
    }
    const { events, versionOk } = parseSessionEvents(text)
    if (!versionOk) {
      console.warn('[dsh] session schema version changed, skipping file:', file)
      skippedFiles++
      continue
    }
    const rows = aggregateEvents(events)
    fileCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, rows })
    all.push(...rows)
  }

  return { rows: all, skippedFiles, totalFiles: files.length }
}
