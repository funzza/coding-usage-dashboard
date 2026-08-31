/**
 * Cursor 登录态读取器(state.vscdb → 会话 cookie)。
 *
 * Cursor(Windows)把登录态存在 `%APPDATA%\Cursor\User\globalStorage\state.vscdb`
 * 的 ItemTable:cursorAuth/accessToken(JWT)+ adminSettings.cachedAuthId(auth0|user_xxx)。
 * 官方客户端主进程就是从这里取 token 打 `Authorization: Bearer`(见 Cursor 安装目录
 * out/main.js);社区实现(CodexBar / TokenTracker)验证 cursor.com 的用量接口认
 * `WorkosCursorSessionToken=<userId>%3A%3A<jwt>` 这个 cookie,2026-08-31 本机实测可用。
 *
 * 安全红线:token 只在主进程内存出现,不进 IPC / 日志 / 错误信息。
 * 不自行 refresh(避免和 Cursor 客户端抢写登录态),token 过期提示用户开一次 Cursor。
 */
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function cursorStateDbPath(): string {
  return join(
    process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
    'Cursor',
    'User',
    'globalStorage',
    'state.vscdb'
  )
}

/** 只读打开;WAL 被 Cursor 占用直开失败时复制 db(+wal/shm)到临时目录再读(与 qoder/zcode 同一策略) */
function openReadOnly(dbPath: string): DatabaseSync {
  try {
    return new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    const dir = mkdtempSync(join(tmpdir(), 'cursor-db-'))
    const copy = join(dir, 'state.vscdb')
    copyFileSync(dbPath, copy)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, copy + suffix)
    }
    return new DatabaseSync(copy, { readOnly: true })
  }
}

/**
 * authId → cookie 里的 userId:
 * - 原生账号 `auth0|user_XXXXX` → `user_XXXXX`
 * - WorkOS 桥接的 OAuth 主体(google-oauth2|… 等)原样保留
 * 与 TokenTracker normalizeCursorSubject 同一规则(2026-08 实测)。
 */
export function normalizeCursorSubject(subject: string | null): string | null {
  if (!subject) return null
  const native = subject.match(/\|(user_[A-Za-z0-9_]+)$/)
  if (native) return native[1]
  if (/^(google-oauth2|github|oidc|auth0)\|[^|]+$/.test(subject)) return subject
  return null
}

/** JWT payload 的 sub 兜底解析(authId key 不存在/改名时用) */
export function userIdFromJwt(jwt: string): string | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as { sub?: unknown }
    return normalizeCursorSubject(typeof payload.sub === 'string' ? payload.sub : null)
  } catch {
    return null
  }
}

export interface CursorAuth {
  accessToken: string
  userId: string
}

/**
 * 读取 Cursor 登录态;state.vscdb 缺失或未登录返回 null。
 * 任何异常都不抛:调用方据此走 absent/skipped fail-soft。
 */
export function readCursorAuth(dbPath: string = cursorStateDbPath()): CursorAuth | null {
  if (!existsSync(dbPath)) return null
  let db: DatabaseSync | null = null
  try {
    db = openReadOnly(dbPath)
    const tokenRow = db
      .prepare(`SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'`)
      .get() as { value: unknown } | undefined
    const token = typeof tokenRow?.value === 'string' && tokenRow.value ? tokenRow.value : null
    if (!token) return null

    let userId: string | null = null
    for (const key of ['adminSettings.cachedAuthId', 'glass.lastSignedInAuthId']) {
      const row = db.prepare(`SELECT value FROM ItemTable WHERE key = ?`).get(key) as
        | { value: unknown }
        | undefined
      userId = normalizeCursorSubject(typeof row?.value === 'string' ? row.value : null)
      if (userId) break
    }
    if (!userId) userId = userIdFromJwt(token)
    if (!userId) return null

    return { accessToken: token, userId }
  } catch (err) {
    console.warn('[cursor] failed to read auth from state.vscdb:', err instanceof Error ? err.message : err)
    return null
  } finally {
    try {
      db?.close()
    } catch {
      /* 关闭失败无碍 */
    }
  }
}

/** cursor.com 用量接口认的会话 cookie */
export function cursorSessionCookie(auth: CursorAuth): string {
  return `WorkosCursorSessionToken=${encodeURIComponent(auth.userId)}%3A%3A${auth.accessToken}`
}

/** 是否已有可用登录态(quota provider 的 credentialExists 用) */
export function cursorCredentialExists(dbPath: string = cursorStateDbPath()): boolean {
  return readCursorAuth(dbPath) !== null
}
