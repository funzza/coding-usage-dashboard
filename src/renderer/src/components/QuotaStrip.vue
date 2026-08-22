<script setup lang="ts">
import { computed } from 'vue'
import type { QuotaAccount, QuotaWindow } from '../../../main/quota/types'
import { agentColor } from '../utils/agent'
import { quotaAlarmLevel, type QuotaAlarmLevel } from '../utils/ball'
import { accountUrgency, displayWindow, quotaBarColor } from '../utils/quota'
import QuotaCard from './QuotaCard.vue'

/**
 * Overview 顶部的订阅速览条:每个账号显示周期最短的窗口(Kimi/Go → 5h,其余 → Weekly),
 * 条目按账号紧急度(任一窗口最高用量)降序。
 * hover 弹出完整 QuotaCard;点击进入 Subscriptions 页。
 * 语义:quota 是"当下状态",与时间范围无关 —— 常驻但不占主内容区。
 */
const props = defineProps<{ accounts: QuotaAccount[] }>()

const sorted = computed(() => [...props.accounts].sort((a, b) => accountUrgency(b) - accountUrgency(a)))

function primary(q: QuotaAccount): QuotaWindow | null {
  return displayWindow(q)
}

function color(q: QuotaAccount): string {
  return agentColor(q.agent)
}

function barColor(q: QuotaAccount, pct: number): string {
  return quotaBarColor(pct, color(q))
}

function alarmOf(q: QuotaAccount): QuotaAlarmLevel | null {
  const w = primary(q)
  return w ? quotaAlarmLevel(w.usedPercent) : null
}
</script>

<template>
  <nav v-if="sorted.length > 0" class="strip" aria-label="Subscriptions">
    <router-link
      v-for="q in sorted"
      :key="q.accountId"
      class="item"
      to="/subscriptions"
      :title="`${q.label} — open Subscriptions`"
    >
      <span class="dot" :style="{ background: color(q) }" />
      <span class="label">{{ q.label }}</span>
      <template v-if="primary(q)">
        <span class="w-label">{{ primary(q)!.label }}</span>
        <span class="mini-bar">
          <span
            class="mini-fill"
            :style="{
              width: `${Math.min(100, primary(q)!.usedPercent)}%`,
              background: barColor(q, primary(q)!.usedPercent)
            }"
          />
        </span>
        <span class="pct" :class="alarmOf(q) ?? ''">{{ Math.round(primary(q)!.usedPercent) }}%</span>
      </template>
      <span v-else class="w-label">—</span>
      <span v-if="q.status === 'error'" class="stale">stale</span>

      <div class="pop" aria-hidden="true">
        <QuotaCard :quota="q" />
      </div>
    </router-link>
  </nav>
</template>

<style scoped>
.strip {
  display: flex;
  align-items: stretch;
  gap: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px 6px;
  overflow: visible;
}

.item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 7px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
}

.item:hover {
  background: var(--hover-bg);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.label {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.w-label {
  font-size: 11px;
  color: var(--text-mute);
  white-space: nowrap;
}

.mini-bar {
  width: 52px;
  height: 4px;
  border-radius: 2px;
  background: var(--track);
  overflow: hidden;
  flex-shrink: 0;
}

.mini-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.pct {
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.pct.warn {
  color: var(--amber);
}

.pct.critical {
  color: var(--red);
}

.stale {
  font-size: 10px;
  color: var(--amber);
}

/* hover 弹出完整卡片;纯展示,不拦截指针 */
.pop {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 40;
  width: 330px;
  padding-top: 4px;
  pointer-events: none;
}

/* 靠右的条目向左展开,避免溢出窗口 */
.item:nth-last-child(-n + 2) .pop {
  left: auto;
  right: 0;
}

.item:hover .pop {
  display: block;
}

.pop :deep(.quota-card) {
  background: var(--tooltip-bg);
  border-color: var(--tooltip-border);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
}

/* ---------- Focus 皮肤:去盒子,上下发丝线 ---------- */
[data-skin='focus'] .strip {
  background: transparent;
  border: none;
  border-top: 1px solid var(--divider);
  border-bottom: 1px solid var(--divider);
  border-radius: 0;
  padding: 2px 0;
}
</style>
