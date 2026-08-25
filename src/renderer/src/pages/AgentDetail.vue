<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { localDateString } from '../../../shared/usage-model'
import type { TokenUsage } from '../../../shared/usage-model'
import {
  RANGE_LABELS,
  aggregateAgentModels,
  aggregateAgents,
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

/** 路由参数即 agentKey(如 `kimi@wsl`);同名 agent 的两侧各自成页 */
const props = defineProps<{ name: string }>()

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

const isToday = computed(() => store.range === 'today')
/** 每次取当前本地日期,避免跨午夜后陈旧 */
const todayIso = (): string => localDateString(new Date())

const rangedDaily = computed(() =>
  store.snapshot ? filterDailyByRange(store.snapshot.daily, store.range) : []
)
const filledDaily = computed(() =>
  store.snapshot ? selectRangeDaily(store.snapshot.daily, store.range) : []
)
const agent = computed(() => aggregateAgents(rangedDaily.value).find((a) => agentKeyOf(a) === props.name))
const models = computed(() => aggregateAgentModels(rangedDaily.value, props.name))
const maxRowTokens = computed(() => models.value[0]?.totalTokens ?? 1)

/** Today 参照系:按该 agent 自己的日序列算分位 */
const milestones = computed(() => {
  if (!store.snapshot || !isToday.value) return null
  const totals = store.snapshot.daily
    .filter((d) => d.date < todayIso())
    .map((d) => d.agents.find((a) => agentKeyOf(a) === props.name)?.totalTokens ?? 0)
  return milestonesOf(totals)
})

/** Today:donut 条目 = 该 agent 的 models,不聚合——所有模型各自一片 */
const donutItems = computed<RankItem[]>(() =>
  models.value.map((m) => ({ name: m.model, color: seriesColor(m.model), usage: m }))
)

const donutCenterSub = computed(() =>
  agent.value ? `${formatCost(agent.value.totalCost)} · ${models.value.length} models` : ''
)
</script>

<template>
  <div v-if="agent" class="page">
    <header class="head drag-head">
      <div class="title">
        <button class="back" title="Back" @click="goBack">←</button>
        <span class="dot" :style="{ background: agentColor(props.name) }" />
        <h1>{{ displayAgentKey(props.name) }}</h1>
      </div>
      <RangeTabs />
    </header>

    <HeroStats
      :usage="agent"
      :range-label="RANGE_LABELS[store.range]"
      :milestones="milestones"
      :today-total="isToday ? agent.totalTokens : undefined"
    />

    <!-- Today:donut(models)+ 明细并排 -->
    <section v-if="isToday" class="panel">
      <h2>Models · Today</h2>
      <div class="share-grid">
        <ShareDonut
          :items="donutItems"
          center-label="Today"
          :center-value="formatTokens(agent.totalTokens)"
          :center-sub="donutCenterSub"
        />
        <ul class="rows">
          <li v-for="m in models" :key="m.model">
            <router-link :to="`/model?name=${encodeURIComponent(m.model)}`" class="row" :title="compositionTooltip(m)">
              <span class="dot" :style="{ background: seriesColor(m.model) }" />
              <span class="name" :title="m.model">{{ m.model }}</span>
              <CompositionBar :usage="m" :max-tokens="maxRowTokens" class="comp" />
              <span class="tokens" :title="m.totalTokens.toLocaleString()">{{
                formatTokens(m.totalTokens)
              }}</span>
              <span class="cost">{{ formatCost(m.totalCost) }}</span>
              <span class="cache">{{ cachedPct(m) }}</span>
            </router-link>
          </li>
        </ul>
      </div>
      <p v-if="models.length === 0" class="empty">No usage today.</p>
    </section>

    <!-- 区间:趋势 + 明细 -->
    <template v-else>
      <section class="panel">
        <h2>Usage Trend · {{ RANGE_LABELS[store.range] }}</h2>
        <TrendChart :days="filledDaily" mode="agent" :name="props.name" :range="store.range" />
      </section>

      <section class="panel">
        <h2>Models · {{ RANGE_LABELS[store.range] }}</h2>
        <ul class="rows">
          <li v-for="m in models" :key="m.model">
            <router-link :to="`/model?name=${encodeURIComponent(m.model)}`" class="row" :title="compositionTooltip(m)">
              <span class="dot" :style="{ background: seriesColor(m.model) }" />
              <span class="name" :title="m.model">{{ m.model }}</span>
              <CompositionBar :usage="m" :max-tokens="maxRowTokens" class="comp" />
              <span class="tokens" :title="m.totalTokens.toLocaleString()">{{
                formatTokens(m.totalTokens)
              }}</span>
              <span class="cost">{{ formatCost(m.totalCost) }}</span>
              <span class="cache">{{ cachedPct(m) }}</span>
            </router-link>
          </li>
        </ul>
        <p v-if="models.length === 0" class="empty">No usage in this range.</p>
      </section>
    </template>
  </div>

  <div v-else class="page empty-state">
    <p>No usage for "{{ name }}" in this range.</p>
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
}

.title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title .dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

h1 {
  font-size: 18px;
  font-weight: 650;
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
}

.back:hover {
  color: var(--text);
  background: var(--seg-active-bg);
}

.row {
  display: grid;
  /* 弹性列:窄窗口下名称列收缩(ellipsis)、数字列收缩到内容宽,表头与数据同轨不脱节 */
  grid-template-columns:
    10px minmax(0, 260px) minmax(24px, 1fr) minmax(auto, 80px) minmax(auto, 70px)
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

.empty {
  color: var(--text-mute);
  font-size: 13px;
  padding: 8px 0;
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
