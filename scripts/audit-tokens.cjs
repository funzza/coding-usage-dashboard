/**
 * 数据一致性审计:各 agent 的 totalTokens 与四项之和的关系。
 * total < sum → input 可能包含 cache(双重计算)
 * total > sum → 存在四项之外的 token(reasoning 等)
 */
const j = require('../fixtures/ccusage-daily-by-agent.json')

const stats = new Map() // agent -> {rows, gt, lt, eq, maxDiffPct, samples}

for (const row of j.daily) {
  for (const a of row.agents || []) {
    const sum4 =
      (a.inputTokens || 0) + (a.outputTokens || 0) + (a.cacheReadTokens || 0) + (a.cacheCreationTokens || 0)
    const total = a.totalTokens || 0
    const key = a.agent
    if (!stats.has(key)) stats.set(key, { rows: 0, gt: 0, lt: 0, eq: 0, maxDiffPct: 0 })
    const s = stats.get(key)
    s.rows++
    if (sum4 === 0) continue
    const diffPct = ((total - sum4) / sum4) * 100
    if (Math.abs(diffPct) > s.maxDiffPct) s.maxDiffPct = Math.abs(diffPct)
    if (total > sum4) s.gt++
    else if (total < sum4) s.lt++
    else s.eq++
  }
}

for (const [agent, s] of stats) {
  console.log(
    `${agent.padEnd(10)} rows=${s.rows}  total>sum4: ${s.gt}  total<sum4: ${s.lt}  eq: ${s.eq}  maxDiff: ${s.maxDiffPct.toFixed(2)}%`
  )
}

// 再看 model 粒度(没有 totalTokens 字段,四项之和即全部)
// 检查 agent 级 totalTokens 是否等于其 modelBreakdowns 四项和
console.log('\n--- agent total vs modelBreakdowns sum4 ---')
for (const row of j.daily.slice(-10)) {
  for (const a of row.agents || []) {
    const msum = (a.modelBreakdowns || []).reduce(
      (acc, mb) =>
        acc + (mb.inputTokens || 0) + (mb.outputTokens || 0) + (mb.cacheReadTokens || 0) + (mb.cacheCreationTokens || 0),
      0
    )
    const total = a.totalTokens || 0
    if (Math.abs(total - msum) > 0) {
      const pct = msum > 0 ? (((total - msum) / msum) * 100).toFixed(2) : 'n/a'
      console.log(`${row.period} ${a.agent}: total=${total} modelSum4=${msum} diff=${pct}%`)
    }
  }
}
