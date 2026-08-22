<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { formatResetIn, formatTokens } from '../../shared/format'
import type { RangeKey } from '../../shared/analytics'
import { useUsageStore } from './stores/usage'
import { useQuotaStore } from './stores/quota'
import { agentColor, displayAgentName, seriesColor } from './utils/agent'
import { quotaAlarmLevel, type QuotaAlarmLevel } from './utils/ball'
import { initWindowDrag } from './utils/window-drag'
import DimensionSwitch from './components/DimensionSwitch.vue'

const store = useUsageStore()
const quotaStore = useQuotaStore()
const route = useRoute()

/** 悬浮球窗口:只渲染页面本身,不带侧边栏,背景透明 */
const isFloat = computed(() => route.path === '/float')

const INSTALL_COMMAND = 'npm install -g ccusage'
const CCUSAGE_REPO = 'https://github.com/ccusage/ccusage'

/** 侧边 Today 速览的维度与 Overview 共用 store.dimension(默认 Models) */
const todayAgents = computed(() => store.snapshot?.daily[store.snapshot.daily.length - 1]?.agents ?? [])

/** 侧边栏快速看板固定为 Today 语义:显示值与排序一致(today tokens 降序) */
const sidebarAgents = computed(() =>
  [...store.agents].sort((a, b) => todayValue(b.agent) - todayValue(a.agent))
)

/** 今天实际用过的模型(跨 agent 聚合),按用量降序 */
const sidebarModels = computed(() => {
  const byModel = new Map<string, number>()
  for (const agent of todayAgents.value) {
    for (const m of agent.models) {
      byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.totalTokens)
    }
  }
  return [...byModel.entries()]
    .map(([model, totalTokens]) => ({ model, totalTokens }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
})

function todayValue(agent: string): number {
  return todayAgents.value.find((a) => a.agent === agent)?.totalTokens ?? 0
}

// ---------- 侧边栏 ALERTS:quota 达阈值的窗口(与悬浮球警示同一套阈值) ----------

interface SidebarAlert {
  key: string
  level: QuotaAlarmLevel
  provider: string
  windowLabel: string
  usedPercent: number
  resetsAt: string | null
}

/** 所有达阈值的窗口,按用量降序(critical 的 98+ 自然排在 warn 前) */
const quotaAlerts = computed<SidebarAlert[]>(() => {
  const list: SidebarAlert[] = []
  for (const account of quotaStore.activeAccounts) {
    for (const w of account.windows) {
      const level = quotaAlarmLevel(w.usedPercent)
      if (level) {
        list.push({
          key: `${account.accountId}:${w.key}`,
          level,
          provider: account.displayName,
          windowLabel: w.label,
          usedPercent: w.usedPercent,
          resetsAt: w.resetsAt
        })
      }
    }
  }
  return list.sort((a, b) => b.usedPercent - a.usedPercent)
})

/** 最多列 3 条,超出折叠为 "+N more" */
const visibleAlerts = computed(() => quotaAlerts.value.slice(0, 3))
const extraAlertCount = computed(() => Math.max(0, quotaAlerts.value.length - 3))

/** 状态栏右端告警点:任一 critical 即红,否则琥珀 */
const statusAlertLevel = computed<QuotaAlarmLevel | null>(() => {
  if (quotaAlerts.value.some((a) => a.level === 'critical')) return 'critical'
  return quotaAlerts.value.length > 0 ? 'warn' : null
})

function alertResetText(alert: SidebarAlert): string {
  return formatResetIn(alert.resetsAt, now.value) ?? ''
}

// ---------- 底部状态栏 ----------

const RANGE_TAGS: Record<RangeKey, string> = { today: 'TODAY', '7d': 'WEEK', '30d': 'MONTH', all: 'ALL' }
const rangeTag = computed(() => RANGE_TAGS[store.range])
const engineVersion = computed(() => store.detect?.version ?? '')
const updatedTime = computed(() => {
  const d = store.lastUpdatedAt
  if (!d) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
})

/** 告警倒计时随时间走,30s 重算 */
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null

function todayTokens(agent: string): string {
  const value = todayValue(agent)
  return value > 0 ? formatTokens(value) : '—'
}

function isActive(path: string): boolean {
  return route.path === path
}

function isModelActive(model: string): boolean {
  return route.path === '/model' && route.query.name === model
}

async function copyInstallCommand(): Promise<void> {
  await navigator.clipboard.writeText(INSTALL_COMMAND)
}

function openRepo(): void {
  window.open(CCUSAGE_REPO, '_blank')
}

// 悬浮球模式下 body 透明;悬浮球页面自己走 store.initPassive(),这里不再 init
watch(
  isFloat,
  (value) => {
    document.body.classList.toggle('float-mode', value)
  },
  { immediate: true }
)

let disposeWindowDrag: (() => void) | null = null

onMounted(() => {
  if (!isFloat.value) void store.init()
  // 主窗口手动拖拽(悬浮球有自己的拖拽通道,不挂这套)
  if (!isFloat.value) disposeWindowDrag = initWindowDrag()
  // quota 轮询在主进程,这里只取缓存 + 订阅广播(两个窗口都是被动消费)
  void quotaStore.init()
  tick = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})

onUnmounted(() => {
  document.body.classList.remove('float-mode')
  disposeWindowDrag?.()
  store.unsubscribeRefreshed?.()
  store.unsubscribeRefreshing?.()
  if (store.autoRefreshTimer) clearInterval(store.autoRefreshTimer)
  if (tick) clearInterval(tick)
})
</script>

<template>
  <!-- 悬浮球窗口:裸页面,无侧边栏布局 -->
  <router-view v-if="isFloat" />

  <template v-else>
  <!-- Setup:未检测到 ccusage -->
  <main v-if="store.status === 'setup'" class="setup drag-region">
    <div class="setup-card">
      <h1>ccusage was not found.</h1>
      <p>Coding Usage Dashboard uses ccusage as its local data engine.</p>
      <p class="install">
        Install: <code>{{ INSTALL_COMMAND }}</code>
      </p>
      <div class="setup-actions">
        <button class="btn primary" @click="store.redetect()">Recheck</button>
        <button class="btn" @click="copyInstallCommand">Copy install command</button>
        <button class="btn" @click="openRepo">Open ccusage GitHub</button>
      </div>
    </div>
  </main>

  <!-- 启动检测 / 首次加载 -->
  <main v-else-if="store.status === 'detecting' || store.status === 'loading'" class="setup drag-region">
    <div class="setup-card">
      <p class="loading-text">
        {{ store.status === 'detecting' ? 'Detecting ccusage…' : 'Loading usage data…' }}
      </p>
      <p class="loading-hint" v-if="store.status === 'loading'">
        The first load runs ccusage once and may take ~20s.
      </p>
    </div>
  </main>

  <!-- 首次加载失败且无任何数据 -->
  <main v-else-if="store.status === 'error'" class="setup drag-region">
    <div class="setup-card">
      <h1>Failed to load usage data</h1>
      <p class="error-text">{{ store.error }}</p>
      <div class="setup-actions">
        <button class="btn primary" @click="store.refresh()">Retry</button>
      </div>
    </div>
  </main>

  <!-- 主界面 -->
  <div v-else class="layout">
    <aside class="sidebar">
      <div class="brand drag-region">
        <span class="brand-mark" />
        <span class="brand-name">Usage</span>
      </div>

      <nav class="nav">
        <!-- 页面导航 -->
        <router-link to="/" class="nav-item" :class="{ active: isActive('/') }">Overview</router-link>
        <router-link to="/sessions" class="nav-item" :class="{ active: isActive('/sessions') }">
          Sessions
        </router-link>
        <router-link
          to="/subscriptions"
          class="nav-item"
          :class="{ active: isActive('/subscriptions') }"
        >
          Subscriptions
        </router-link>

        <div class="nav-divider" />

        <!-- Today 速览:固定今日语义;维度开关与 Overview 全局联动 -->
        <p class="nav-section">Today</p>
        <DimensionSwitch class="dim-switch" />

        <template v-if="store.dimension === 'agents'">
          <router-link
            v-for="agent in sidebarAgents"
            :key="agent.agent"
            :to="`/agents/${agent.agent}`"
            class="nav-item agent"
            :class="{ active: isActive(`/agents/${agent.agent}`) }"
          >
            <span class="dot" :style="{ background: agentColor(agent.agent) }" />
            <span class="agent-name">{{ displayAgentName(agent.agent) }}</span>
            <span class="agent-today">{{ todayTokens(agent.agent) }}</span>
          </router-link>
        </template>

        <template v-else>
          <router-link
            v-for="m in sidebarModels"
            :key="m.model"
            :to="`/model?name=${encodeURIComponent(m.model)}`"
            class="nav-item agent"
            :class="{ active: isModelActive(m.model) }"
          >
            <span class="dot" :style="{ background: seriesColor(m.model) }" />
            <span class="agent-name" :title="m.model">{{ m.model }}</span>
            <span class="agent-today">{{ formatTokens(m.totalTokens) }}</span>
          </router-link>
          <p v-if="sidebarModels.length === 0" class="nav-empty">No model usage today.</p>
        </template>

        <div v-if="visibleAlerts.length > 0" class="alerts">
          <p class="alerts-title">Alerts</p>
          <p v-for="a in visibleAlerts" :key="a.key" class="alert-row" :class="a.level">
            {{ a.provider }} · {{ a.windowLabel }}
            <span class="alert-pct">{{ Math.round(a.usedPercent) }}%</span>
            <span v-if="alertResetText(a)" class="alert-reset"> · resets {{ alertResetText(a) }}</span>
          </p>
          <p v-if="extraAlertCount > 0" class="alert-more">+{{ extraAlertCount }} more</p>
        </div>
      </nav>

      <div class="sidebar-bottom">
        <router-link to="/settings" class="nav-item" :class="{ active: isActive('/settings') }">
          Settings
        </router-link>
        <button class="refresh-btn" :disabled="store.refreshing" @click="store.refresh()">
          <span class="spinner" v-if="store.refreshing" />
          {{ store.refreshing ? 'Refreshing…' : 'Refresh' }}
        </button>
        <p class="updated" v-if="store.lastUpdatedAt">
          Updated {{ store.lastUpdatedAt.toLocaleTimeString() }}
        </p>
      </div>
    </aside>

    <section class="content">
      <div class="content-main">
        <div v-if="store.error" class="warning-banner">
          Last refresh failed: {{ store.error }} — showing previous data.
          <button class="link" @click="store.refresh()">Retry</button>
        </div>

        <div v-if="store.snapshot && store.snapshot.daily.length === 0" class="empty">
          <p>No usage data yet. Use a coding agent, then refresh.</p>
        </div>

        <router-view v-else />
      </div>

      <footer class="statusbar">
        <span>RANGE {{ rangeTag }}</span>
        <span>{{ store.agents.length }} AGENTS</span>
        <span v-if="engineVersion">CCUSAGE {{ engineVersion }}</span>
        <span v-if="store.refreshing">REFRESHING…</span>
        <span v-else-if="updatedTime">UPDATED {{ updatedTime }}</span>
        <span v-if="statusAlertLevel" class="status-alert" :class="statusAlertLevel">
          <span class="status-dot" />{{ quotaAlerts.length }}
          {{ quotaAlerts.length === 1 ? 'ALERT' : 'ALERTS' }}
        </span>
      </footer>
    </section>
  </div>
  </template>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 216px 1fr;
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid var(--divider);
  padding: 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  position: sticky;
  top: 0;
  height: 100vh;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
}

.brand-mark {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(135deg, var(--accent), var(--green));
}

.brand-name {
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.nav-section {
  font-size: 11px;
  color: var(--text-mute);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 8px 6px;
}

.nav-divider {
  height: 1px;
  background: var(--divider);
  margin: 10px 4px;
}

.dim-switch {
  margin: 0 0 6px;
}

.nav-empty {
  font-size: 12px;
  color: var(--text-mute);
  padding: 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-dim);
  text-decoration: none;
}

.nav-item:hover {
  background: var(--hover-bg);
  color: var(--text);
}

.nav-item.active {
  background: var(--active-bg);
  color: var(--text);
}

.nav-item .dot {
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
}

.agent-today {
  font-size: 11px;
  color: var(--text-mute);
  font-variant-numeric: tabular-nums;
}

.sidebar-bottom {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--border);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--border-strong);
}

.refresh-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.spinner {
  width: 12px;
  height: 12px;
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

.updated {
  font-size: 11px;
  color: var(--text-mute);
  text-align: center;
}

.content {
  min-width: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.content-main {
  padding: 24px 28px;
  flex: 1;
  min-width: 0;
}

.statusbar {
  position: sticky;
  bottom: 0;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 28px;
  border-top: 1px solid var(--divider);
  background: var(--bg);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--text-mute);
  font-variant-numeric: tabular-nums;
}

.status-alert {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-alert.warn {
  color: var(--amber);
}

.status-alert.critical {
  color: var(--red);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.alerts {
  margin: 10px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.alerts-title {
  font-size: 10.5px;
  color: var(--text-mute);
  text-transform: uppercase;
  letter-spacing: 0.09em;
  padding: 0 8px 3px;
}

.alert-row {
  position: relative;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-dim);
  padding: 3px 8px 3px 12px;
}

.alert-row::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 5px;
  bottom: 5px;
  width: 2px;
  border-radius: 1px;
}

.alert-row.warn::before {
  background: var(--amber);
}

.alert-row.critical::before {
  background: var(--red);
}

.alert-row.warn .alert-pct {
  color: var(--amber);
}

.alert-row.critical .alert-pct {
  color: var(--red);
}

.alert-pct {
  font-variant-numeric: tabular-nums;
}

.alert-reset {
  color: var(--text-mute);
}

.alert-more {
  font-size: 10.5px;
  color: var(--text-mute);
  padding: 2px 8px 0 12px;
}

.warning-banner {
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  color: var(--warning-text);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.link {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
}

.empty {
  color: var(--text-dim);
  padding: 40px 0;
  text-align: center;
}

.setup {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.setup-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 32px 36px;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setup-card h1 {
  font-size: 18px;
  font-weight: 650;
}

.setup-card p {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.6;
}

.install code {
  background: var(--bg);
  padding: 3px 10px;
  border-radius: 6px;
  color: var(--green);
}

.setup-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.btn {
  background: var(--border);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}

.btn:hover {
  background: var(--border-strong);
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
  font-weight: 600;
}

.btn.primary:hover {
  background: var(--accent-hover);
}

.loading-text {
  font-size: 14px;
  color: var(--text);
}

.loading-hint {
  font-size: 12px;
}

.error-text {
  color: var(--red);
  word-break: break-all;
}

/* ---------- Focus 皮肤:侧栏更窄更静,主区留白加大 ---------- */
[data-skin='focus'] .layout {
  grid-template-columns: 200px 1fr;
}

[data-skin='focus'] .sidebar {
  padding: 26px 14px 20px 20px;
  gap: 14px;
}

[data-skin='focus'] .brand {
  padding: 2px 8px 0 8px;
}

[data-skin='focus'] .brand-name {
  font-size: 15px;
}

/* 分组标签(Today)更小更灰 */
[data-skin='focus'] .nav-section {
  font-size: 10.5px;
  letter-spacing: 0.09em;
  color: var(--text-mute);
  padding: 2px 8px 6px;
}

[data-skin='focus'] .nav-item {
  font-size: 12.5px;
  padding: 6px 8px;
}

[data-skin='focus'] .nav-item.active {
  background: var(--active-bg);
}

[data-skin='focus'] .refresh-btn {
  background: transparent;
  border-color: var(--border);
  justify-content: flex-start;
}

[data-skin='focus'] .refresh-btn:hover:not(:disabled) {
  background: var(--hover-bg);
}

[data-skin='focus'] .updated {
  text-align: left;
  padding: 0 8px;
}

[data-skin='focus'] .content-main {
  padding: 28px 42px 26px 40px;
}

[data-skin='focus'] .statusbar {
  padding: 0 40px;
}
</style>
