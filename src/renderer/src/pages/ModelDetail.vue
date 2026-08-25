<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { localDateString } from '../../../shared/usage-model'
import type { TokenUsage } from '../../../shared/usage-model'
import {
  RANGE_LABELS,
  aggregateModels,
  cacheReadShare,
  filterDailyByRange,
  milestonesOf,
  selectRangeDaily
} from '../../../shared/analytics'
import { formatCost, formatTokens } from '../../../shared/format'
import ShareDonut from '../charts/ShareDonut.vue'
import TrendChart from '../charts/TrendChart.vue'
import CompositionBar from '../components/CompositionBar.vue'
import HeroStats from '../components/HeroStats.vue'
import RangeTabs from '../components/RangeTabs.vue'
import { useUsageStore } from '../stores/usage'
import { agentColor, agentKeyOf, displayAgentKey, seriesColor } from '../utils/agent'
import { compositionTooltip, type RankItem } from '../utils/composition'

const props = defineProps<{ name?: string }>()

const route = useRoute()
const router = useRouter()
const store = useUsageStore()

/** 从明细行点进来后的返回途径;直接打开详情时回 Overview */
function goBack() {
  if (window.history.state?.back) router.back()
  else router.push('/')
}

/** Cached Input Share:cacheRead / (input + cacheRead);无输入侧数据时显示 — */
function cachedPct(u: TokenUsage): string {
  return u.cacheReadTokens + u.inputTokens > 0
    ? `${(cacheReadShare(u) * 100).toFixed(1)}%`
    : '—'
}

const modelName = computed(() => String(route.query.name ?? props.name ?? ''))

const isToday = computed(() => store.range === 'today')
/** 每次取当前本地日期,避免跨午夜后陈旧 */
const todayIso = (): string => localDateString(new Date())

const rangedDaily = computed(() =>
  store.snapshot ? filterDailyByRange(store.snapshot.daily, store.range) : []
)
const filledDaily = computed(() =>
  store.snapshot ? selectRangeDaily(store.snapshot.daily, store.range) : []
)
const model = computed(() =>
  aggregateModels(rangedDaily.value).find((m) => m.model === modelName.value)
)
const maxRowTokens = computed(() => model.value?.agents[0]?.totalTokens ?? 1)

/** Today 参照系:按该 model 自己的日序列算分位 */
const milestones = computed(() => {
  if (!store.snapshot || !isToday.value) return null
  const totals = store.snapshot.daily
    .filter((d) => d.date < todayIso())
    .map((d) => {
      let sum = 0
      for (const a of d.agents) {
        const m = a.models.find((x) => x.model === modelName.value)
        if (m) sum += m.totalTokens
      }
      return sum
    })
  return milestonesOf(totals)
})

/** Today:donut 条目 = 该 model 在各 agent 下的用量(agent×origin 分行) */
const donutItems = computed<RankItem[]>(
  () =>
    model.value?.agents.map((a) => ({
      name: displayAgentKey(agentKeyOf(a)),
      color: agentColor(agentKeyOf(a)),
      usage: a
    })) ?? []
)

const donutCenterSub = computed(() =>
  model.value ? `${formatCost(model.value.totalCost)} · ${model.value.agents.length} agents` : ''
)
</script>

<template>
  <div v-if="model" class="page">
    <header class="head drag-head">
      <div class="title">
        <button class="back" title="Back" @click="goBack">←</button>
        <span class="dot" :style="{ background: seriesColor(model.model) }" />
        <h1>{{ model.model }}</h1>
      </div>
      <RangeTabs />
    </header>

    <HeroStats
      :usage="model"
      :range-label="RANGE_LABELS[store.range]"
      :milestones="milestones"
      :today-total="isToday ? model.totalTokens : undefined"
    />

    <!-- Today:donut(agents)+ 明细并排 -->
    <section v-if="isToday" class="panel">
      <h2>Used By · Today</h2>
      <div class="share-grid">
        <ShareDonut
          :items="donutItems"
          center-label="Today"
          :center-value="formatTokens(model.totalTokens)"
          :center-sub="donutCenterSub"
        />
        <ul class="rows">
          <li v-for="a in model.agents" :key="agentKeyOf(a)">
            <router-link :to="`/agents/${agentKeyOf(a)}`" class="row" :title="compositionTooltip(a)">
              <span class="dot" :style="{ background: agentColor(agentKeyOf(a)) }" />
              <span class="name">{{ displayAgentKey(agentKeyOf(a)) }}</span>
              <CompositionBar :usage="a" :max-tokens="maxRowTokens" class="comp" />
              <span class="tokens" :title="a.totalTokens.toLocaleString()">{{
                formatTokens(a.totalTokens)
              }}</span>
              <span class="cost">{{ formatCost(a.totalCost) }}</span>
              <span class="cache">{{ cachedPct(a) }}</span>
            </router-link>
          </li>
        </ul>
      </div>
    </section>

    <!-- 区间:趋势 + 明细 -->
    <template v-else>
      <section class="panel">
        <h2>Usage Trend · {{ RANGE_LABELS[store.range] }}</h2>
        <TrendChart :days="filledDaily" mode="model" :name="model.model" :range="store.range" />
      </section>

      <section class="panel">
        <h2>Used By · {{ RANGE_LABELS[store.range] }}</h2>
        <ul class="rows">
          <li v-for="a in model.agents" :key="agentKeyOf(a)">
            <router-link :to="`/agents/${agentKeyOf(a)}`" class="row" :title="compositionTooltip(a)">
              <span class="dot" :style="{ background: agentColor(agentKeyOf(a)) }" />
              <span class="name">{{ displayAgentKey(agentKeyOf(a)) }}</span>
              <CompositionBar :usage="a" :max-tokens="maxRowTokens" class="comp" />
              <span class="tokens" :title="a.totalTokens.toLocaleString()">{{
                formatTokens(a.totalTokens)
              }}</span>
              <span class="cost">{{ formatCost(a.totalCost) }}</span>
              <span class="cache">{{ cachedPct(a) }}</span>
            </router-link>
          </li>
        </ul>
      </section>
    </template>
  </div>

  <div v-else class="page empty-state">
    <p>No usage for model "{{ modelName }}" in this range.</p>
    <router-link to="/">Back to Overview</router-link>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.title .dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

h1 {
  font-size: 18px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
}

h2 {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.share-grid {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 48px;
  align-items: center;
}

.rows {
  list-style: none;
}

.back {
  background: transparent;
  border: none;
  color: var(--text-mute);
  font-size: 15px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
}

.back:hover {
  color: var(--text);
  background: var(--seg-active-bg);
}

.row {
  display: grid;
  /* 弹性列:窄窗口下名称列收缩(ellipsis)、数字列收缩到内容宽,表头与数据同轨不脱节 */
  grid-template-columns:
    10px minmax(0, 140px) minmax(24px, 1fr) minmax(auto, 80px) minmax(auto, 70px)
    minmax(auto, 56px);
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  text-decoration: none;
  color: inherit;
}

.row:hover .name {
  color: var(--accent);
}

.row .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tokens {
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cost {
  font-size: 12px;
  color: var(--text-mute);
  text-align: right;
  white-space: nowrap;
}

.cache {
  font-size: 11px;
  color: var(--text-mute);
  text-align: right;
  white-space: nowrap;
}

.empty-state {
  color: var(--text-dim);
}

.empty-state a {
  color: var(--accent);
}

/* ---------- Focus 皮肤 ---------- */
[data-skin='focus'] .page {
  gap: 34px;
}

[data-skin='focus'] h1 {
  font-size: 15px;
  font-weight: 600;
}

[data-skin='focus'] .panel {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}

[data-skin='focus'] h2 {
  font-size: 10.5px;
  letter-spacing: 0.09em;
  color: var(--text-mute);
}

[data-skin='focus'] .row + .row {
  border-top: 1px solid var(--divider);
}

@media (max-width: 1240px) {
  [data-skin='focus'] .share-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
</style>
