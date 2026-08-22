<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { localDateString } from '../../../shared/usage-model'
import {
  RANGE_LABELS,
  aggregateAgents,
  aggregateModels,
  bucketDaily,
  filterDailyByRange,
  rangeStats,
  selectRangeDaily,
  sessionsHourlyBuckets,
  sumDaily,
  usageMilestones
} from '../../../shared/analytics'
import { formatCost, formatTokens } from '../../../shared/format'
import HourlyActivityChart from '../charts/HourlyActivityChart.vue'
import ShareDonut from '../charts/ShareDonut.vue'
import ShareDriftChart from '../charts/ShareDriftChart.vue'
import TrendChart from '../charts/TrendChart.vue'
import WeekdayRhythmChart from '../charts/WeekdayRhythmChart.vue'
import BreakdownRows from '../components/BreakdownRows.vue'
import HeroStats from '../components/HeroStats.vue'
import QuotaStrip from '../components/QuotaStrip.vue'
import RangeTabs from '../components/RangeTabs.vue'
import StatsStrip from '../components/StatsStrip.vue'
import { useQuotaStore } from '../stores/quota'
import { useSessionsStore } from '../stores/sessions'
import { useUsageStore } from '../stores/usage'
import { agentColor, displayAgentName, seriesColor } from '../utils/agent'
import { topWithOther, type RankItem } from '../utils/composition'

/**
 * Overview 两套布局:
 * - Today:QuotaStrip(订阅速览,常驻)→ Hero(+milestone 参照行)→ 24h 活动图(session 口径)→ donut + 明细
 * - 7D/30D/All:QuotaStrip → Hero → Stats strip(环比等)→ 趋势 → Share Drift + 星期节律 → 明细
 * 时间上下文来自头部 RangeTabs(store.range);维度上下文来自侧栏 DimensionSwitch(store.dimension);
 * quota 是"当下状态",与时间范围无关,strip 常驻所有范围,完整卡片在 Subscriptions 页。
 */
const store = useUsageStore()
const quotaStore = useQuotaStore()
const sessionsStore = useSessionsStore()

/** 有凭据的订阅账号(unavailable 的不占位);error 态保留展示 */
const quotaAccounts = computed(() => quotaStore.activeAccounts)

const isToday = computed(() => store.range === 'today')
/** 每次取当前本地日期,避免跨午夜后陈旧 */
const todayIso = (): string => localDateString(new Date())

const snapshot = computed(() => store.snapshot)
const rangedDaily = computed(() =>
  snapshot.value ? filterDailyByRange(snapshot.value.daily, store.range) : []
)
const filledDaily = computed(() =>
  snapshot.value ? selectRangeDaily(snapshot.value.daily, store.range) : []
)
const totals = computed(() => sumDaily(rangedDaily.value))
const agents = computed(() => aggregateAgents(rangedDaily.value))
const models = computed(() => aggregateModels(rangedDaily.value))

/** Today 参照系:历史分位里程碑(空历史返回 null,参照行自动隐藏) */
const milestones = computed(() =>
  snapshot.value && isToday.value ? usageMilestones(snapshot.value.daily, todayIso()) : null
)

/** 区间统计(仅非 today) */
const stats = computed(() =>
  snapshot.value && !isToday.value ? rangeStats(snapshot.value.daily, store.range) : null
)

const PREV_LABELS = { today: 'yesterday', '7d': 'prev week', '30d': 'prev month', all: '' } as const
const prevLabel = computed(() => PREV_LABELS[store.range])

/** Share Drift 的粒度跟随趋势默认:All 先按周 bucket,其余按天 */
const driftDays = computed(() =>
  store.range === 'all' ? bucketDaily(filledDaily.value, 'week') : filledDaily.value
)

/** Today 活动图:session 数据按小时分桶(仅 today 态懒加载) */
const hourlyBuckets = computed(() =>
  sessionsHourlyBuckets(sessionsStore.report?.sessions ?? [], todayIso())
)

const list = computed(() => (store.dimension === 'agents' ? agents.value : models.value))
const maxRowTokens = computed(() => list.value[0]?.totalTokens ?? 1)

/** donut 条目:与明细列表同源(models 截断 top 10,其余合计为 Other) */
const donutItems = computed<RankItem[]>(() => {
  if (store.dimension === 'agents') {
    return agents.value.map((a) => ({
      name: displayAgentName(a.agent),
      color: agentColor(a.agent),
      usage: a
    }))
  }
  return topWithOther(
    models.value.map((m) => ({ name: m.model, color: seriesColor(m.model), usage: m }))
  )
})

const donutCenterSub = computed(() => {
  const n = list.value.length
  const unit = store.dimension === 'agents' ? 'agents' : 'models'
  return `${formatCost(totals.value.totalCost)} · ${n} ${unit}`
})

const sectionTitle = computed(() => {
  if (isToday.value) return store.dimension === 'agents' ? 'Today by Agent' : 'Today by Model'
  return `${store.dimension === 'agents' ? 'Agents' : 'Models'} · ${RANGE_LABELS[store.range]}`
})

const trendSub = computed(
  () => `${RANGE_LABELS[store.range]} · ${store.dimension === 'agents' ? 'by agent' : 'by model'}`
)

/** 进入 Today 才懒加载 session 数据(store 内有 TTL + 防并发) */
function ensureSessionsForToday(): void {
  if (store.range === 'today') void sessionsStore.ensure()
}

onMounted(ensureSessionsForToday)
watch(() => store.range, ensureSessionsForToday)
</script>

<template>
  <div v-if="snapshot" class="page">
    <header class="head drag-head">
      <h1>Overview</h1>
      <div class="head-controls">
        <RangeTabs />
      </div>
    </header>

    <!-- 订阅速览条:常驻所有范围,但不占主内容区;完整卡片与账号管理在 Subscriptions 页 -->
    <QuotaStrip :accounts="quotaAccounts" />

    <HeroStats
      :usage="totals"
      :range-label="RANGE_LABELS[store.range]"
      :milestones="milestones"
      :today-total="isToday ? totals.totalTokens : undefined"
    />

    <StatsStrip v-if="stats" :stats="stats" :prev-label="prevLabel" />

    <!-- Today:24h 活动图(session lastActivity 口径) -->
    <section v-if="isToday" class="panel">
      <div class="panel-head">
        <h2 class="trend-title">
          Today's Activity
          <span class="trend-sub">by session · hover for detail</span>
        </h2>
      </div>
      <p v-if="sessionsStore.loading && !sessionsStore.report" class="hint">
        Running ccusage session… this may take a minute.
      </p>
      <HourlyActivityChart v-else :buckets="hourlyBuckets" />
    </section>

    <!-- 区间:趋势图 -->
    <section v-else class="panel">
      <div class="panel-head">
        <h2 class="trend-title">
          Daily Usage
          <span class="trend-sub">{{ trendSub }}</span>
        </h2>
      </div>
      <TrendChart :days="filledDaily" :mode="store.dimension" :range="store.range" />
    </section>

    <!-- 区间:结构漂移 + 星期节律 -->
    <section v-if="!isToday" class="duo">
      <div class="panel duo-panel">
        <h2 class="trend-title">
          Share Drift
          <span class="trend-sub">{{ trendSub }} · 100% stacked</span>
        </h2>
        <ShareDriftChart :days="driftDays" :mode="store.dimension" />
      </div>
      <div class="panel duo-panel">
        <h2 class="trend-title">
          Weekday Rhythm
          <span class="trend-sub">avg tokens by weekday</span>
        </h2>
        <WeekdayRhythmChart :days="filledDaily" />
      </div>
    </section>

    <!-- Today:donut + 明细并排;区间:明细整行 -->
    <section class="panel">
      <h2 class="list-title">{{ sectionTitle }}</h2>
      <div v-if="isToday" class="share-grid">
        <ShareDonut
          :items="donutItems"
          center-label="Today"
          :center-value="formatTokens(totals.totalTokens)"
          :center-sub="donutCenterSub"
        />
        <BreakdownRows
          :dimension="store.dimension"
          :agents="agents"
          :models="models"
          :max-tokens="maxRowTokens"
          :total-tokens="totals.totalTokens"
        />
      </div>
      <BreakdownRows
        v-else
        :dimension="store.dimension"
        :agents="agents"
        :models="models"
        :max-tokens="maxRowTokens"
        :total-tokens="totals.totalTokens"
      />
    </section>
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

.head-controls {
  display: flex;
  align-items: center;
  gap: 12px;
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

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.panel-head h2 {
  margin-bottom: 0;
}

h2 {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.trend-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.trend-sub {
  font-size: 11px;
  color: var(--text-mute);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
  margin-left: 10px;
}

.list-title {
  margin-bottom: 4px;
}

.duo {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
}

.duo-panel {
  min-width: 0;
}

.share-grid {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 48px;
  align-items: center;
}

.hint {
  font-size: 12px;
  color: var(--text-mute);
}

/* ---------- Focus 皮肤:分区去盒子化,留白 + 小标题分隔 ---------- */
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

/* 趋势区标题保留正常大小(与 mockup 的 trend-title 一致) */
[data-skin='focus'] .trend-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  text-transform: none;
  letter-spacing: 0;
}

[data-skin='focus'] .trend-sub {
  font-size: 11px;
  color: var(--text-mute);
}

[data-skin='focus'] .duo {
  gap: 48px;
}

@media (max-width: 1240px) {
  [data-skin='focus'] .share-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  [data-skin='focus'] .duo {
    grid-template-columns: 1fr;
    gap: 34px;
  }
}
</style>
