// 一次性探测脚本:验证 zcode db 的可读性、schema、聚合 SQL 与 token 语义
const { DatabaseSync } = require('node:sqlite')
const os = require('node:os')
const path = require('node:path')

const p = path.join(os.homedir(), '.zcode/cli/db/db.sqlite')
const db = new DatabaseSync(p, { readOnly: true })

const cols = db.prepare('PRAGMA table_info(model_usage)').all().map((c) => c.name)
const need = [
  'started_at',
  'model_id',
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'reasoning_tokens',
  'status'
]
console.log('columns ok:', need.every((c) => cols.includes(c)))

const rows = db
  .prepare(
    `SELECT date(started_at/1000, 'unixepoch', 'localtime') AS day, model_id AS model,
            COUNT(*) AS n,
            SUM(input_tokens) AS input, SUM(output_tokens) AS output,
            SUM(reasoning_tokens) AS reasoning,
            SUM(cache_read_input_tokens) AS cacheRead, SUM(cache_creation_input_tokens) AS cacheCreate,
            SUM(computed_total_tokens) AS reportedTotal
     FROM model_usage
     WHERE status = 'completed' AND started_at IS NOT NULL
     GROUP BY day, model ORDER BY day DESC, reportedTotal DESC LIMIT 14`
  )
  .all()
console.log(JSON.stringify(rows, null, 1))

const t = db.prepare('SELECT COUNT(*) c, COUNT(DISTINCT session_id) s FROM model_usage').get()
console.log('rows:', t.c, 'sessions:', t.s)
const d = db
  .prepare(
    "SELECT MIN(date(started_at/1000,'unixepoch','localtime')) mn, MAX(date(started_at/1000,'unixepoch','localtime')) mx FROM model_usage"
  )
  .get()
console.log('date range:', d.mn, '..', d.mx)

// input 是否包含 cache(决定归一化时是否要做减法)
const check = db
  .prepare(
    `SELECT model_id,
            SUM(input_tokens) i, SUM(cache_read_input_tokens) cr, SUM(cache_creation_input_tokens) cc,
            SUM(output_tokens) o, SUM(reasoning_tokens) r, SUM(computed_total_tokens) total
     FROM model_usage WHERE status='completed' GROUP BY model_id LIMIT 20`
  )
  .all()
for (const c of check) {
  const a = c.i + c.o + c.r // total == i+o+reasoning 则 input 含 cache
  const b = c.i - c.cr - c.cc + c.o + c.r // total == 这个 则 input 不含 cache
  console.log(
    c.model_id,
    'total=' + c.total,
    'i+o+r=' + a,
    'i-cr-cc+o+r=' + b,
    a === c.total ? '=> input INCLUDES cache' : b === c.total ? '=> input EXCLUDES cache' : '=> unclear'
  )
}

db.close()
