<script setup lang="ts">
import { computed } from 'vue'
import type { QuotaWindow } from '../../../main/quota/types'
import type { AgentUsage, TokenUsage } from '../../../shared/usage-model'
import { localDateString } from '../../../shared/usage-model'
import { aggregateAgents, sumDaily } from '../../../shared/analytics'
import { formatTokens } from '../../../shared/format'
import { useUsageStore } from '../stores/usage'
import { cycleStart } from '../utils/cycle'

/**
 * quota 窗口旁的"本周期 tokens":从 usage snapshot 的 daily 切片
 * [周期起点, 今天] 本地聚合,不触发任何新的 ccusage 调用。
 * quota 与 usage 是两套独立口径(单位、刷新节奏都不同),这里只做并排参考,
 * 绝不做百分比 ↔ token 的换算。
 */
const props = defineProps<{ window: QuotaWindow }>()

const store = useUsageStore()

interface CycleStat {
  total: TokenUsage
  topAgents: AgentUsage[]
  from: string
}

const stat = computed<CycleStat | null>(() => {
  const daily = store.snapshot?.daily
  if (!daily) return null
  const start = cycleStart(props.window)
  if (!start) return null
  const from = localDateString(start)
  const to = localDateString(new Date())
  const days = daily.filter((d) => d.date >= from && d.date <= to)
  return { total: sumDaily(days), topAgents: aggregateAgents(days).slice(0, 3), from }
})

const tooltip = computed(() => {
  if (!stat.value) return ''
  const lines = [
    `${stat.value.total.totalTokens.toLocaleString()} tokens this cycle (all agents, since ${stat.value.from})`
  ]
  for (const a of stat.value.topAgents) {
    lines.push(`${a.agent}: ${formatTokens(a.totalTokens)}`)
  }
  return lines.join('\n')
})
</script>

<template>
  <span class="cycle" :title="tooltip">
    <template v-if="stat">
      <b>{{ formatTokens(stat.total.totalTokens) }}</b>
      <i>this cycle</i>
    </template>
  </span>
</template>

<style scoped>
.cycle {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.2;
  min-width: 0;
}

.cycle b {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.cycle i {
  font-style: normal;
  font-size: 10px;
  color: var(--text-mute);
}
</style>
