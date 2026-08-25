<script setup lang="ts">
import { computed } from 'vue'
import type { AgentUsage, ModelAggregate, TokenUsage } from '../../../shared/usage-model'
import { cacheReadShare } from '../../../shared/analytics'
import { formatCost, formatTokens } from '../../../shared/format'
import { agentColor, agentKeyOf, displayAgentKey, seriesColor } from '../utils/agent'
import { compositionTooltip } from '../utils/composition'
import CompositionBar from './CompositionBar.vue'

/**
 * 明细列表(Overview / Today 共用):等比构成条 + tokens/cost/share/cached。
 * 条长 ∝ maxTokens(区间第一名满宽),量级差异一眼可比。
 * 整行 hover 即显示构成明细,不限于细条本身。
 */
const props = defineProps<{
  dimension: 'agents' | 'models'
  agents: AgentUsage[]
  models: ModelAggregate[]
  maxTokens: number
  /** share 分母:区间总量 */
  totalTokens: number
}>()

const isEmpty = computed(() =>
  props.dimension === 'agents' ? props.agents.length === 0 : props.models.length === 0
)

function share(total: number): string {
  return props.totalTokens > 0 ? `${((total / props.totalTokens) * 100).toFixed(1)}%` : '0%'
}

/** Cached Input Share:cacheRead / (input + cacheRead);无输入侧数据时显示 — */
function cachedPct(u: TokenUsage): string {
  return u.cacheReadTokens + u.inputTokens > 0
    ? `${(cacheReadShare(u) * 100).toFixed(1)}%`
    : '—'
}

function modelLink(model: string): string {
  return `/model?name=${encodeURIComponent(model)}`
}
</script>

<template>
  <!-- 单根容器:本组件会被放进 grid 布局(share-grid 的明细列)。
       多根 fragment 会被 grid 拆成多个独立格子(表头与数据各占一格、宽窄不一),
       单根保证整体只占一格,表头与数据永远同宽对齐 -->
  <div class="breakdown">
    <template v-if="!isEmpty">
      <div class="row col-head" :class="{ model: dimension === 'models' }">
        <span /><span /><span />
        <span class="tokens">Tokens</span>
        <span class="cost">Cost</span>
        <span class="pct">Share</span>
        <span class="cache" title="Cached Input Share = cache read / (input + cache read)">Cached</span>
      </div>

      <ul v-if="dimension === 'agents'" class="rows">
        <li v-for="a in agents" :key="agentKeyOf(a)">
          <router-link :to="`/agents/${agentKeyOf(a)}`" class="row" :title="compositionTooltip(a)">
            <span class="dot" :style="{ background: agentColor(agentKeyOf(a)) }" />
            <span class="name">{{ displayAgentKey(agentKeyOf(a)) }}</span>
            <CompositionBar :usage="a" :max-tokens="maxTokens" class="comp" />
            <span class="tokens" :title="a.totalTokens.toLocaleString()">{{ formatTokens(a.totalTokens) }}</span>
            <span class="cost">{{ formatCost(a.totalCost) }}</span>
            <span class="pct">{{ share(a.totalTokens) }}</span>
            <span class="cache">{{ cachedPct(a) }}</span>
          </router-link>
        </li>
      </ul>

      <ul v-else class="rows">
        <li v-for="m in models" :key="m.model">
          <router-link :to="modelLink(m.model)" class="row model" :title="compositionTooltip(m)">
            <span class="dot" :style="{ background: seriesColor(m.model) }" />
            <span class="name" :title="m.model">{{ m.model }}</span>
            <CompositionBar :usage="m" :max-tokens="maxTokens" class="comp" />
            <span class="tokens" :title="m.totalTokens.toLocaleString()">{{ formatTokens(m.totalTokens) }}</span>
            <span class="cost">{{ formatCost(m.totalCost) }}</span>
            <span class="pct">{{ share(m.totalTokens) }}</span>
            <span class="cache">{{ cachedPct(m) }}</span>
          </router-link>
        </li>
      </ul>
    </template>

    <p v-else class="empty">No usage in this range.</p>
  </div>
</template>

<style scoped>
.breakdown {
  min-width: 0;
}

.rows {
  list-style: none;
}

.row {
  display: grid;
  /* 列宽弹性:名称列可收缩(ellipsis),数字列 minmax(auto, x) 宽裕时取 x、
     窄窗口收缩到内容宽——表头与数据永远在同一列轨道上,缩放不脱节 */
  grid-template-columns:
    10px minmax(0, 140px) minmax(24px, 1fr) minmax(auto, 80px) minmax(auto, 70px)
    minmax(auto, 52px) minmax(auto, 56px);
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  text-decoration: none;
  color: inherit;
}

.row.model {
  grid-template-columns:
    10px minmax(0, 240px) minmax(24px, 1fr) minmax(auto, 80px) minmax(auto, 70px)
    minmax(auto, 52px) minmax(auto, 56px);
}

.col-head {
  padding: 0 0 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.row:hover .name {
  color: var(--accent);
}

.dot {
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
  white-space: nowrap;
}

.cost {
  font-size: 12px;
  color: var(--text-mute);
  text-align: right;
  white-space: nowrap;
}

.pct {
  font-size: 11px;
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

[data-skin='focus'] .rows .row + .row {
  border-top: 1px solid var(--divider);
}
</style>
