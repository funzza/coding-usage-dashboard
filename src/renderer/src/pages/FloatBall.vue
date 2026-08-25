<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { formatResetIn, formatTokens } from '../../../shared/format'
import { useUsageStore } from '../stores/usage'
import { useQuotaStore } from '../stores/quota'
import { agentColor, agentKeyOf, displayAgentKey, quotaAgentKey } from '../utils/agent'
import {
  QUOTA_ALARM_COLORS,
  quotaAlarmLevel,
  resolveBallVisual,
  resolveQuotaAlarm,
  resolveQuotaRing
} from '../utils/ball'
import BallVisual from '../components/BallVisual.vue'
import { FLOAT_SIZE_PX, type FloatConfig } from '../../../shared/float-config'
import type { FloatAnchor } from '../../../main/float'

/**
 * 悬浮球页面(折叠态圆球 / 320x260 展开面板):
 * - 悬停经 main 防抖后调整窗口 bounds,resolve 回来的锚角决定球与面板的相对位置
 * - 球体上的拖拽把屏幕坐标转发给 main;位移 <5px 的 mouseup 由 main 视为单击打开主窗口
 * - 数据走 store.initPassive():只吃广播和缓存快照,绝不自己 spawn ccusage
 * - 球体视觉在 BallVisual;外观配置(size/opacity/animation/colorMode)由 main 持久化并推送
 */
const store = useUsageStore()
const quotaStore = useQuotaStore()

const expanded = ref(false)
const anchor = ref<FloatAnchor>({ horizontal: 'right', vertical: 'bottom' })
/** 记录最近一次请求,防止 expand/collapse 两个异步回复乱序覆盖 */
let requestedExpanded = false

// 外观配置:挂载时拉取,之后吃 main 推送(Settings 改动实时生效)
const config = ref<FloatConfig>({
  size: 'm',
  opacity: 1,
  animation: 'lively',
  colorMode: 'adaptive',
  shape: 'ball'
})
let unsubscribeConfig: (() => void) | null = null

const ballSize = computed(() => FLOAT_SIZE_PX[config.value.size])
const ballModel = computed(() => resolveBallVisual(store.snapshot, config.value.colorMode))

const todayTotal = computed(() => store.snapshot?.today.totalTokens ?? 0)

/** 今日各 agent 用量,按 token 降序 */
const todayAgents = computed(() => {
  const agents = store.snapshot?.daily[store.snapshot.daily.length - 1]?.agents ?? []
  return [...agents].sort((a, b) => b.totalTokens - a.totalTokens)
})

// "x 分钟前"需要随时间走,每 30s 重算一次
const now = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

/** 每个订阅账号一行:最紧张(用量百分比最高)的窗口;tooltip 给全部窗口明细 */
const quotaRows = computed(() =>
  quotaStore.activeAccounts
    .map((q) => {
      const tightest = q.windows.reduce(
        (max, w) => (w.usedPercent > (max?.usedPercent ?? -1) ? w : max),
        q.windows[0] ?? null
      )
      const detail = q.windows
        .map((w) => `${w.label} ${Math.round(w.usedPercent)}%`)
        .join(' · ')
      return { quota: q, tightest, detail, level: quotaAlarmLevel(tightest?.usedPercent ?? 0) }
    })
    .filter((r) => r.tightest !== null)
)

/** 球体警示:全账号全窗口里最紧张者达阈值时外显(被动消费 quota 缓存,不触发 refresh) */
const quotaAlarm = computed(() => resolveQuotaAlarm(quotaStore.activeAccounts))

/** ring 形态取数:最紧张订阅窗口的消耗百分比(无阈值,环永远反映当前最紧状态) */
const quotaRing = computed(() => resolveQuotaRing(quotaStore.activeAccounts))

function quotaBarColor(percent: number): string {
  if (percent >= 85) return '#f87171'
  if (percent >= 60) return '#F6BD16'
  return '#5AD8A6'
}

function quotaResetText(resetsAt: string | null): string {
  return formatResetIn(resetsAt, now.value) ?? ''
}

const updatedText = computed(() => {
  const at = store.lastUpdatedAt
  if (!at) return 'No data yet'
  const mins = Math.max(0, Math.round((now.value - at.getTime()) / 60_000))
  if (mins < 1) return 'Updated just now'
  return mins === 1 ? 'Updated 1 min ago' : `Updated ${mins} min ago`
})

async function setExpanded(next: boolean): Promise<void> {
  requestedExpanded = next
  const a = await window.usageApi.floatSetExpanded(next)
  anchor.value = a
  if (requestedExpanded === next) expanded.value = next
}

// ---- 拖拽(pointer capture 保证拖出窗口仍能收到 move/up)----
let dragging = false

function onBallPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  dragging = true
  // 展开态拖拽:main 会先收回窗口,这里同步收面板
  expanded.value = false
  requestedExpanded = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  window.usageApi.floatDragStart(event.screenX, event.screenY)
}

function onBallPointerMove(event: PointerEvent): void {
  if (!dragging) return
  window.usageApi.floatDragMove(event.screenX, event.screenY)
}

function onBallPointerUp(event: PointerEvent): void {
  if (!dragging) return
  dragging = false
  window.usageApi.floatDragEnd(event.screenX, event.screenY)
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  window.usageApi.floatShowMenu()
}

onMounted(async () => {
  void store.initPassive()
  config.value = await window.usageApi.floatGetConfig()
  unsubscribeConfig = window.usageApi.onFloatConfig((next) => {
    config.value = next
  })
  tickTimer = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
  unsubscribeConfig?.()
  store.unsubscribeRefreshed?.()
  store.unsubscribeRefreshing?.()
})
</script>

<template>
  <div
    class="float-root"
    :class="[`h-${anchor.horizontal}`, `v-${anchor.vertical}`, { expanded }]"
    @mouseenter="void setExpanded(true)"
    @mouseleave="void setExpanded(false)"
  >
    <section v-if="expanded" class="panel" :style="{ height: `calc(100% - ${ballSize + 8}px)` }">
      <header class="panel-head">
        <span class="panel-title">Today</span>
        <span class="panel-total">{{ formatTokens(todayTotal) }}</span>
      </header>

      <ul class="agent-list" v-if="todayAgents.length > 0">
        <li v-for="agent in todayAgents" :key="agentKeyOf(agent)">
          <span class="dot" :style="{ background: agentColor(agentKeyOf(agent)) }" />
          <span class="agent-name">{{ displayAgentKey(agentKeyOf(agent)) }}</span>
          <span class="agent-value">{{ formatTokens(agent.totalTokens) }}</span>
        </li>
      </ul>
      <p v-else class="panel-empty">No usage data yet.</p>

      <!-- 订阅额度:每行展示该订阅最紧张的窗口,全部窗口明细在 tooltip -->
      <div v-if="quotaRows.length > 0" class="quota-block">
        <div class="quota-row" v-for="r in quotaRows" :key="r.quota.accountId" :title="r.detail">
          <span class="dot" :style="{ background: agentColor(quotaAgentKey(r.quota.agent, r.quota.origin)) }" />
          <span class="quota-name">{{ r.quota.origin === 'wsl' ? `${r.quota.label} · WSL` : r.quota.label }}</span>
          <span class="quota-window">{{ r.tightest!.label }}</span>
          <span class="quota-bar">
            <span
              class="quota-fill"
              :style="{
                width: `${r.tightest!.usedPercent}%`,
                background: r.level ? QUOTA_ALARM_COLORS[r.level] : quotaBarColor(r.tightest!.usedPercent)
              }"
            />
          </span>
          <span
            class="quota-pct"
            :style="r.level ? { color: QUOTA_ALARM_COLORS[r.level] } : undefined"
          >{{ Math.round(r.tightest!.usedPercent) }}%</span>
          <span class="quota-reset">{{ quotaResetText(r.tightest!.resetsAt) }}</span>
        </div>
      </div>

      <footer class="panel-foot">
        <span v-if="store.refreshing" class="refreshing">
          <span class="spinner" />Refreshing…
        </span>
        <span v-else-if="store.error" class="error" :title="store.error">Last refresh failed</span>
        <span v-else>{{ updatedText }}</span>
      </footer>
    </section>

    <BallVisual
      class="ball"
      :total="todayTotal"
      :tier="ballModel.tier"
      :fill-ratio="ballModel.fillRatio"
      :size="ballSize"
      :opacity="config.opacity"
      :animation="config.animation"
      :refreshing="store.refreshing"
      :error="store.error"
      :alarm="quotaAlarm?.level ?? null"
      :shape="config.shape"
      :quota-percent="quotaRing ? Math.round(quotaRing.percent) : null"
      :title="`Today ${formatTokens(todayTotal)}${quotaRing ? ` · ${quotaRing.accountLabel} ${quotaRing.windowLabel} ${Math.round(quotaRing.percent)}%` : ''}`"
      @pointerdown="onBallPointerDown"
      @pointermove="onBallPointerMove"
      @pointerup="onBallPointerUp"
      @contextmenu="onContextMenu"
    />
  </div>
</template>

<style scoped>
.float-root {
  position: fixed;
  inset: 0;
  overflow: hidden;
}

/* ---- 球体:视觉在 BallVisual,这里只负责窗口内锚角定位 ---- */
.ball {
  position: absolute;
}

.h-left .ball {
  left: 0;
}

.h-right .ball {
  right: 0;
}

.v-top .ball {
  top: 0;
}

.v-bottom .ball {
  bottom: 0;
}

/* ---- 展开面板:位于球的对侧 ---- */
.panel {
  position: absolute;
  left: 0;
  right: 0;
  /* 高度由模板按球尺寸动态计算,留出球的位置 */
  background: var(--float-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.v-bottom .panel {
  top: 0;
}

.v-top .panel {
  bottom: 0;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.panel-title {
  font-size: 11px;
  color: var(--text-mute);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.panel-total {
  font-size: 18px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.agent-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 3px 2px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.agent-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
}

.agent-value {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.panel-empty {
  flex: 1;
  font-size: 12px;
  color: var(--text-mute);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---- 订阅额度块 ---- */
.quota-block {
  border-top: 1px solid var(--border);
  padding-top: 7px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex-shrink: 0;
}

.quota-row {
  display: grid;
  grid-template-columns: 7px 74px 44px 1fr 30px 52px;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.quota-name {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quota-window {
  color: var(--text-mute);
}

.quota-bar {
  height: 4px;
  background: var(--track);
  border-radius: 2px;
  overflow: hidden;
}

.quota-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
}

.quota-pct {
  text-align: right;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.quota-reset {
  text-align: right;
  color: var(--text-mute);
  font-size: 10px;
}

.panel-foot {
  font-size: 11px;
  color: var(--text-mute);
  display: flex;
  align-items: center;
  gap: 6px;
}

.refreshing {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--spinner-track);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error {
  color: var(--red);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
