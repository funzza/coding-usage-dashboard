import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { localDateString } from '../../shared/usage-model'
import { loadQoderDailyRows } from './reader'

/**
 * reader 单元测试:在临时目录造 fixture SQLite(模拟 local.db / state.vscdb),
 * 不依赖真实 Qoder 安装。覆盖:聚合、模型名两跳解析、缓存兜底、schema 守卫、缺库。
 */

const MS_1 = Date.UTC(2026, 7, 21, 4, 0, 0) // 2026-08-21 04:00 UTC
const MS_2 = Date.UTC(2026, 7, 22, 4, 0, 0)
const DAY_1 = localDateString(new Date(MS_1))
const DAY_2 = localDateString(new Date(MS_2))

interface FixtureOptions {
  /** 是否故意缺列(模拟上游 schema 变更) */
  brokenSchema?: boolean
}

function makeFixture(options: FixtureOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qoder-reader-test-'))
  const dbPath = join(dir, 'local.db')
  const vscdbPath = join(dir, 'state.vscdb')
  const cachePath = join(dir, 'cache.json')

  const db = new DatabaseSync(dbPath)
  if (options.brokenSchema) {
    db.exec(`CREATE TABLE chat_message (session_id TEXT, role TEXT, token_info TEXT, gmt_create INTEGER)`)
    db.exec(`CREATE TABLE chat_session (session_id TEXT, preferred_model_info TEXT)`)
  } else {
    db.exec(
      `CREATE TABLE chat_message (id TEXT, session_id TEXT, role TEXT, token_info TEXT, model_info TEXT, gmt_create INTEGER)`
    )
    db.exec(`CREATE TABLE chat_session (session_id TEXT, preferred_model_info TEXT)`)
  }

  if (!options.brokenSchema) {
    const insertSession = db.prepare(
      `INSERT INTO chat_session (session_id, preferred_model_info) VALUES (?, ?)`
    )
    const insertMessage = db.prepare(
      `INSERT INTO chat_message (session_id, role, token_info, model_info, gmt_create) VALUES (?, ?, ?, ?, ?)`
    )
    // s1: BYOK 会话(preferred 指向 customModels 里的 model_a)
    insertSession.run('s1', JSON.stringify({ preferred_model: 'custom:model_a' }))
    // s2: 云端档位会话
    insertSession.run('s2', JSON.stringify({ preferred_model: 'qmodel_preview' }))
    // s3: BYOK 会话但模型已被用户删除(vscdb 里没有 model_gone)
    insertSession.run('s3', JSON.stringify({ preferred_model: 'custom:model_gone' }))

    const ti = (p: number, c: number, cached: number) =>
      JSON.stringify({ prompt_tokens: p, completion_tokens: c, cached_tokens: cached, max_input_tokens: 1000 })

    // s1 两条 custom_model(不同天)
    insertMessage.run('s1', 'assistant', ti(1000, 100, 800), JSON.stringify({ model_key: 'custom_model' }), MS_1)
    insertMessage.run('s1', 'assistant', ti(2000, 200, 1500), JSON.stringify({ model_key: 'custom_model' }), MS_2)
    // s2 一条档位模型
    insertMessage.run('s2', 'assistant', ti(500, 50, 0), JSON.stringify({ model_key: 'qmodel_preview' }), MS_1)
    // s3 一条已删 BYOK
    insertMessage.run('s3', 'assistant', ti(300, 30, 100), JSON.stringify({ model_key: 'custom_model' }), MS_1)
    // model_info 损坏:回退到 session preferred(s2 → qmodel_preview)
    insertMessage.run('s2', 'assistant', ti(60, 6, 0), 'not-json', MS_1)
    // user 行无 token_info,应被 WHERE 过滤
    insertMessage.run('s1', 'user', null, null, MS_1)
  }
  db.close()

  const vdb = new DatabaseSync(vscdbPath)
  vdb.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)`)
  vdb
    .prepare(`INSERT INTO ItemTable (key, value) VALUES ('aicoding.customModels', ?)`)
    .run(
      JSON.stringify([
        { id: 'model_a', provider: 'bailian', model: 'qwen3.8-max-tp', displayName: 'Qwen-3.8-Max' }
      ])
    )
  vdb.close()

  return { dbPath, vscdbPath, cachePath }
}

describe('loadQoderDailyRows (fixture db)', () => {
  it('aggregates by day × model and resolves custom model names via vscdb', () => {
    const { dbPath, vscdbPath, cachePath } = makeFixture()
    const { rows, error } = loadQoderDailyRows(dbPath, vscdbPath, cachePath)
    expect(error).toBeUndefined()
    expect(rows).not.toBeNull()

    const byKey = new Map(rows!.map((r) => [`${r.day}|${r.model}`, r]))
    // custom_model 两跳解析成 Qwen-3.8-Max,按天分开
    expect(byKey.get(`${DAY_1}|Qwen-3.8-Max`)).toMatchObject({
      promptTokens: 1000, completionTokens: 100, cachedTokens: 800, requests: 1
    })
    expect(byKey.get(`${DAY_2}|Qwen-3.8-Max`)).toMatchObject({ promptTokens: 2000, requests: 1 })
    // 档位模型直接用 model_key;损坏的 model_info 回退 session preferred,并入同桶
    expect(byKey.get(`${DAY_1}|qmodel_preview`)).toMatchObject({
      promptTokens: 560, completionTokens: 56, requests: 2
    })
    // 已删 BYOK:无缓存时保留原始 id
    expect(byKey.get(`${DAY_1}|model_gone`)).toMatchObject({ promptTokens: 300, requests: 1 })
    // 按天升序
    const days = rows!.map((r) => r.day)
    expect([...days].sort()).toEqual(days)
  })

  it('resolves deleted BYOK models via persisted name cache, and writes cache for future runs', () => {
    const { dbPath, vscdbPath, cachePath } = makeFixture()
    // 预置缓存:model_gone 曾经叫 GLM-5.2
    writeFileSync(cachePath, JSON.stringify({ model_gone: 'GLM-5.2' }), 'utf-8')
    const { rows } = loadQoderDailyRows(dbPath, vscdbPath, cachePath)
    const byKey = new Map(rows!.map((r) => [`${r.day}|${r.model}`, r]))
    expect(byKey.get(`${DAY_1}|GLM-5.2`)).toMatchObject({ promptTokens: 300 })
    expect(byKey.has(`${DAY_1}|model_gone`)).toBe(false)
  })

  it('returns error on schema change (missing model_info column)', () => {
    const { dbPath, vscdbPath } = makeFixture({ brokenSchema: true })
    const { rows, error } = loadQoderDailyRows(dbPath, vscdbPath)
    expect(rows).toBeNull()
    expect(error).toMatch(/schema changed/)
  })

  it('returns { rows: null } without error when db is absent', () => {
    const { rows, error } = loadQoderDailyRows(
      join(tmpdir(), 'qoder-definitely-not-exists.db'),
      join(tmpdir(), 'qoder-definitely-not-exists.vscdb')
    )
    expect(rows).toBeNull()
    expect(error).toBeUndefined()
  })
})
