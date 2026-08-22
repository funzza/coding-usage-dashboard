<script setup lang="ts">
import { computed } from 'vue'
import type { TokenUsage } from '../../../shared/usage-model'
import { cacheReadShare, usageTier, type Milestones } from '../../../shared/analytics'
import { formatCost, formatTokens } from '../../../shared/format'
import CompositionBar from './CompositionBar.vue'

/**
 * 统一的总量+构成展示。
 * 关键区分:New tokens(input+output+cacheCreation,真实新产生)
 * vs Cached(cacheRead,缓存读取),避免 Total 被缓存量淹没造成误读。
 * Today 视图可传 milestones + todayTotal,显示"今天算什么水平"参照行。
 */
const props = defineProps<{
  usage: TokenUsage
  rangeLabel: string
  /** Today 限定:历史分位里程碑(无则不显示参照行) */
  milestones?: Milestones | null
  /** Today 限定:今日总量,用于 tier 判断 */
  todayTotal?: number
}>()

const newTokens = computed(
  () => props.usage.inputTokens + props.usage.outputTokens + props.usage.cacheCreationTokens
)
const cachedSharePct = computed(() => (cacheReadShare(props.usage) * 100).toFixed(1))

const TIER_TEXT = {
  cool: 'A quiet day',
  brand: 'Around your typical day',
  warm: 'Above your typical day',
  blazing: 'Well above your typical day'
} as const

/** 参照行:tier 文案 + 分位数值;无历史(新用户)不显示 */
const milestoneLine = computed(() => {
  if (!props.milestones || props.todayTotal === undefined) return null
  const tier = usageTier(props.todayTotal, props.milestones)
  return {
    tier,
    text: TIER_TEXT[tier],
    vals: `median ${formatTokens(props.milestones.median)} · p75 ${formatTokens(
      props.milestones.p75
    )} · p90 ${formatTokens(props.milestones.p90)}`
  }
})

/** cacheCreation 恒 0 的 harness(codex/grok/kimi 等)源日志不上报该字段,显示 — 而非 0 */
function formatOrUnreported(value: number): string {
  return value > 0 ? formatTokens(value) : '—'
}
</script>

<template>
  <section class="panel hero">
    <div class="hero-total">
      <span class="k">Total Tokens · {{ rangeLabel }}</span>
      <span class="big" :title="usage.totalTokens.toLocaleString()">
        {{ formatTokens(usage.totalTokens) }}
      </span>
      <span class="cost">{{ formatCost(usage.totalCost) }}</span>
      <span class="split">
        <span class="split-new" title="Input + Output + Cache Creation(新产生的 token)">
          New {{ formatTokens(newTokens) }}
        </span>
        <span class="split-sep">·</span>
        <span class="split-cached" title="Cache Read(缓存读取,重复利用已有上下文)">
          Cached {{ formatTokens(usage.cacheReadTokens) }}
        </span>
      </span>
      <span v-if="milestoneLine" class="milestone" :class="milestoneLine.tier">
        <span class="milestone-tag">{{ milestoneLine.text }}</span>
        <span class="milestone-vals">{{ milestoneLine.vals }}</span>
      </span>
    </div>

    <div class="hero-detail">
      <CompositionBar :usage="usage" class="hero-bar" />
      <div class="items">
        <div class="item">
          <span class="k"><span class="dot" style="background: var(--comp-input)" />Input</span>
          <span class="v">{{ formatTokens(usage.inputTokens) }}</span>
        </div>
        <div class="item">
          <span class="k"><span class="dot" style="background: var(--comp-output)" />Output</span>
          <span class="v">{{ formatTokens(usage.outputTokens) }}</span>
        </div>
        <div class="item">
          <span class="k"><span class="dot" style="background: var(--comp-cache-creation)" />Cache Creation</span>
          <span class="v" :title="usage.cacheCreationTokens === 0 ? '该数据源不上报此字段' : undefined">
            {{ formatOrUnreported(usage.cacheCreationTokens) }}
          </span>
        </div>
        <div class="item">
          <span class="k"><span class="dot" style="background: var(--comp-cache-read)" />Cache Read</span>
          <span class="v">{{ formatTokens(usage.cacheReadTokens) }}</span>
        </div>
        <div class="item">
          <span class="k">Cached Input Share</span>
          <span
            class="v"
            title="输入侧由缓存提供的占比:cacheRead / (cacheRead + input)。接近 100% 是正常的:长会话里大部分输入来自缓存。"
          >
            {{ cachedSharePct }}%
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
}

.hero {
  display: flex;
  align-items: flex-start;
  gap: 48px;
}

.hero-total {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}

.k {
  font-size: 11px;
  color: var(--text-mute);
  display: flex;
  align-items: center;
  gap: 6px;
}

.big {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text-bright);
}

.cost {
  font-size: 13px;
  color: var(--text-mute);
}

.split {
  margin-top: 6px;
  font-size: 12px;
  display: flex;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}

.split-new {
  color: var(--green);
}

.split-cached {
  color: var(--comp-cache-read);
}

.milestone {
  margin-top: 8px;
  font-size: 12px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.milestone-tag {
  font-weight: 600;
  color: var(--text-dim);
}

.milestone.warm .milestone-tag,
.milestone.blazing .milestone-tag {
  color: var(--amber);
}

.milestone-vals {
  color: var(--text-mute);
  font-variant-numeric: tabular-nums;
}

.split-sep {
  color: var(--spinner-track);
}

.hero-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.hero-bar {
  width: 100%;
  height: 8px;
}

.items {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}

.v {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ---------- Focus 皮肤:去盒子化,大数字 + 全宽细构成条 + 单行图例 ---------- */
[data-skin='focus'] .panel {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}

[data-skin='focus'] .hero {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
}

[data-skin='focus'] .hero-total {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 18px;
}

[data-skin='focus'] .hero-total > .k {
  flex: 0 0 100%;
  font-size: 12.5px;
  color: var(--text-dim);
}

[data-skin='focus'] .big {
  flex: 0 0 100%;
  font-size: 52px;
  line-height: 1;
  margin: 8px 0 14px;
}

[data-skin='focus'] .cost {
  font-size: 19px;
  font-weight: 650;
  color: var(--text-strong);
}

[data-skin='focus'] .split {
  margin-top: 0;
  font-size: 12.5px;
}

/* 参照行独占一行,跟在 cost/split 之后 */
[data-skin='focus'] .milestone {
  flex: 0 0 100%;
  margin-top: 8px;
  font-size: 12.5px;
}

[data-skin='focus'] .split-new,
[data-skin='focus'] .split-cached {
  color: var(--text-dim);
}

[data-skin='focus'] .hero-detail {
  padding-top: 0;
  margin-top: 26px;
  gap: 12px;
}

[data-skin='focus'] .hero-bar {
  height: 6px;
}

[data-skin='focus'] .items {
  gap: 26px;
  flex-wrap: nowrap;
  align-items: baseline;
}

[data-skin='focus'] .item {
  flex-direction: row;
  align-items: baseline;
  gap: 7px;
}

[data-skin='focus'] .item .k {
  font-size: 12px;
  color: var(--text-dim);
}

[data-skin='focus'] .item .dot {
  border-radius: 50%;
}

[data-skin='focus'] .item .v {
  font-size: 12px;
  font-weight: 600;
  color: #c3c9d4;
}

/* Cached Input Share 固定在图例行右端 */
[data-skin='focus'] .item:last-child {
  margin-left: auto;
}

[data-skin='focus'] .item:last-child .v {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text);
}
</style>
