/** 各 agent 全周期 token 构成,检查 cacheCreation 等字段是否普遍缺失 */
const j = require('../fixtures/ccusage-daily-by-agent.json')

const agg = new Map()
for (const row of j.daily) {
  for (const a of row.agents || []) {
    if (!agg.has(a.agent)) agg.set(a.agent, { input: 0, output: 0, cr: 0, cc: 0, total: 0 })
    const s = agg.get(a.agent)
    s.input += a.inputTokens || 0
    s.output += a.outputTokens || 0
    s.cr += a.cacheReadTokens || 0
    s.cc += a.cacheCreationTokens || 0
    s.total += a.totalTokens || 0
  }
}

console.log('agent        input        output       cacheRead    cacheCreate  total        cc=0?')
for (const [agent, s] of [...agg.entries()].sort((a, b) => b[1].total - a[1].total)) {
  const f = (n) => (n / 1e6).toFixed(1).padStart(10) + 'M'
  console.log(
    `${agent.padEnd(12)}${f(s.input)}${f(s.output)}${f(s.cr)}${f(s.cc)}${f(s.total)}  ${s.cc === 0 ? 'YES' : ''}`
  )
}
