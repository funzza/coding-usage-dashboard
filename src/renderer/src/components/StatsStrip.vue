<script setup lang="ts">
import { computed } from 'vue'
import type { RangeStats } from '../../../shared/analytics'
import { formatTokens, shortDate } from '../../../shared/format'

/**
 * 区间统计条:Avg/Day、Busiest Day、Active Days、环比上一等长窗口。
 * 环比只做陈述(▲▼ 中性色),不做红绿褒贬;prevDelta 为 null 时整项隐藏。
 */
const props = defineProps<{
  stats: RangeStats
  /** 环比比较对象的文案,如 'prev 30 days' / 'yesterday' */
  prevLabel: string
}>()

const deltaText = computed(() => {
  const d = props.stats.prevDelta
  if (d === null) return null
  const pct = Math.abs(d * 100)
  const digits = pct >= 100 ? 0 : 1
  return `${d >= 0 ? '▲ +' : '▼ −'}${pct.toFixed(digits)}%`
})
</script>

<template>
  <section class="stats">
    <div class="stat">
      <p class="sk">Avg / Day</p>
      <p class="sv" :title="Math.round(stats.avgPerDay).toLocaleString()">
        {{ formatTokens(stats.avgPerDay) }}
      </p>
      <p class="ss">across {{ stats.days }} {{ stats.days === 1 ? 'day' : 'days' }}</p>
    </div>
    <div class="stat">
      <p class="sk">Busiest Day</p>
      <template v-if="stats.busiestDay">
        <p class="sv">{{ shortDate(stats.busiestDay.date) }}</p>
        <p class="ss">{{ formatTokens(stats.busiestDay.totalTokens) }} tokens</p>
      </template>
      <template v-else>
        <p class="sv">—</p>
        <p class="ss">no usage</p>
      </template>
    </div>
    <div class="stat">
      <p class="sk">Active Days</p>
      <p class="sv">{{ stats.activeDays }} / {{ stats.days }}</p>
      <p class="ss">{{ stats.days - stats.activeDays }} quiet</p>
    </div>
    <div v-if="deltaText" class="stat">
      <p class="sk">vs {{ prevLabel }}</p>
      <p class="sv delta">{{ deltaText }}</p>
      <p class="ss">total tokens</p>
    </div>
  </section>
</template>

<style scoped>
.stats {
  display: flex;
  gap: 56px;
  align-items: baseline;
  flex-wrap: wrap;
}

.sk {
  font-size: 10.5px;
  letter-spacing: 0.09em;
  color: var(--text-mute);
  text-transform: uppercase;
}

.sv {
  font-size: 17px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  margin-top: 3px;
  color: var(--text-strong);
}

.sv.delta {
  color: var(--amber);
}

.ss {
  font-size: 11px;
  color: var(--text-mute);
  margin-top: 1px;
}
</style>
