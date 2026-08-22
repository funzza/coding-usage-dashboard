/** 探查②:model_info 分布(JS 解析,容错)+ state.vscdb customModels 结构 */
const { DatabaseSync } = require('node:sqlite')
const { join } = require('node:path')

const APPDATA = process.env.APPDATA
const LOCAL_DB = join(APPDATA, 'QoderCN', 'SharedClientCache', 'cache', 'db', 'local.db')
const VSCDB = join(APPDATA, 'QoderCN', 'User', 'globalStorage', 'state.vscdb')

const db = new DatabaseSync(LOCAL_DB, { readOnly: true })
const rows = db
  .prepare(
    `SELECT model_info FROM chat_message WHERE role = 'assistant' AND token_info IS NOT NULL`
  )
  .all()
const dist = new Map()
let bad = 0
for (const r of rows) {
  try {
    const mi = JSON.parse(String(r.model_info ?? '{}'))
    const k = mi.model_key ?? '(none)'
    dist.set(k, (dist.get(k) ?? 0) + 1)
  } catch {
    bad++
  }
}
console.log('model_key distribution:', JSON.stringify([...dist.entries()]))
console.log('unparseable model_info:', bad, '/', rows.length)

// preferred_model_info 样式分布(session 级)
const sess = db
  .prepare(`SELECT session_id, preferred_model_info FROM chat_session WHERE preferred_model_info IS NOT NULL`)
  .all()
const pmiSamples = new Map()
for (const s of sess) {
  try {
    const p = JSON.parse(String(s.preferred_model_info))
    const pm = String(p.preferred_model ?? '')
    const prefix = pm.split(':')[0] || '(raw)'
    if (!pmiSamples.has(prefix)) pmiSamples.set(prefix, pm)
  } catch {
    /* skip */
  }
}
console.log('preferred_model prefixes:', JSON.stringify([...pmiSamples.entries()]))
db.close()

const vdb = new DatabaseSync(VSCDB, { readOnly: true })
const tables = vdb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((t) => t.name)
console.log('\nstate.vscdb tables:', tables.join(', '))
const row = vdb.prepare(`SELECT value FROM ItemTable WHERE key = 'aicoding.customModels'`).get()
if (row) {
  const models = JSON.parse(String(row.value))
  console.log('customModels count:', models.length)
  console.log('sample:', JSON.stringify(models.slice(0, 3), null, 2))
} else {
  const keys2 = vdb.prepare(`SELECT key FROM ItemTable WHERE key LIKE 'aicoding.%'`).all()
  console.log('aicoding.customModels NOT found; aicoding keys:', keys2.map((k) => k.key).join(', '))
}
vdb.close()
