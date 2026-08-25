<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { formatDuration } from '../../../shared/format'
import { useUsageStore } from '../stores/usage'
import { displaySourceName } from '../../../shared/agents'
import { resolveBallVisual, resolveQuotaRing } from '../utils/ball'
import { useQuotaStore } from '../stores/quota'
import { activeSkinId, setSkin } from '../utils/skin'
import { SKINS } from '../../../shared/skins'
import BallVisual from '../components/BallVisual.vue'
import {
  FLOAT_SIZE_PX,
  type FloatAnimation,
  type FloatColorMode,
  type FloatConfig,
  type FloatShape,
  type FloatSize
} from '../../../shared/float-config'

const store = useUsageStore()

const engine = computed(() => store.snapshot?.engine ?? null)
const detect = computed(() => store.detect)

// 悬浮球开关与外观配置:状态在主进程持久化,这里只做读写
const floatEnabled = ref(false)
const floatConfig = ref<FloatConfig>({
  size: 'm',
  opacity: 1,
  animation: 'lively',
  colorMode: 'adaptive',
  shape: 'ball'
})
const quotaStore = useQuotaStore()

// 开机自启动:状态由主进程读注册表 Run 键,切换即生效,失败回滚
const autoLaunch = ref(false)
const autoLaunchError = ref('')

async function toggleAutoLaunch(): Promise<void> {
  autoLaunchError.value = ''
  try {
    await window.usageApi.setAutoLaunch(autoLaunch.value)
  } catch (err) {
    autoLaunch.value = !autoLaunch.value
    // ipc 抛出的 Error 消息带 "Error invoking remote method" 前缀,剥掉
    autoLaunchError.value =
      err instanceof Error ? err.message.replace(/^.*Error:\s*/, '') : 'Failed to update setting'
  }
}

onMounted(async () => {
  floatEnabled.value = (await window.usageApi.floatGetState()).enabled
  floatConfig.value = await window.usageApi.floatGetConfig()
  autoLaunch.value = await window.usageApi.getAutoLaunch()
})

async function toggleFloat(): Promise<void> {
  await window.usageApi.floatSetEnabled(floatEnabled.value)
}

/** 乐观更新本地预览,再以 main 返回值为准(main 会做合法性钳制) */
async function updateFloatConfig(partial: Partial<FloatConfig>): Promise<void> {
  floatConfig.value = { ...floatConfig.value, ...partial }
  floatConfig.value = await window.usageApi.floatUpdateConfig(partial)
}

const shapeOptions: Array<{ value: FloatShape; label: string }> = [
  { value: 'ball', label: 'Usage' },
  { value: 'ring', label: 'Quota' }
]

const sizeOptions: Array<{ value: FloatSize; label: string }> = [
  { value: 's', label: 'S' },
  { value: 'm', label: 'M' },
  { value: 'l', label: 'L' }
]
const animationOptions: Array<{ value: FloatAnimation; label: string }> = [
  { value: 'lively', label: 'Lively' },
  { value: 'calm', label: 'Calm' }
]
const colorModeOptions: Array<{ value: FloatColorMode; label: string }> = [
  { value: 'adaptive', label: 'Adaptive' },
  { value: 'fixed', label: 'Brand' }
]

// 实时预览:用真实数据按当前配置渲染一个球
const previewSize = computed(() => FLOAT_SIZE_PX[floatConfig.value.size])
const previewModel = computed(() => resolveBallVisual(store.snapshot, floatConfig.value.colorMode))
const previewTotal = computed(() => store.snapshot?.today.totalTokens ?? 0)
const previewQuotaPercent = computed(() => {
  const ring = resolveQuotaRing(quotaStore.activeAccounts)
  return ring ? Math.round(ring.percent) : null
})
</script>

<template>
  <div class="page">
    <h1 class="drag-head">Settings</h1>

    <section class="panel">
      <h2>Data Engine</h2>
      <template v-if="engine || detect?.found">
        <dl>
          <div class="row">
            <dt>Engine</dt>
            <dd>ccusage</dd>
          </div>
          <div class="row">
            <dt>Version</dt>
            <dd>{{ engine?.version ?? detect?.version }}</dd>
          </div>
          <div class="row">
            <dt>Path</dt>
            <dd class="path">{{ engine?.path ?? detect?.path }}</dd>
          </div>
          <div class="row" v-if="store.snapshot">
            <dt>Last refresh</dt>
            <dd>
              {{ new Date(store.snapshot.generatedAt).toLocaleTimeString() }} · took
              {{ formatDuration(store.snapshot.refreshDurationMs) }}
            </dd>
          </div>
          <!-- 额外数据源状态(ccusage 未覆盖的本地 agent,如 ZCode/DSH) -->
          <div class="row" v-for="(s, name) in store.snapshot?.sources ?? {}" :key="name">
            <dt>{{ displaySourceName(name) }}</dt>
            <dd>
              <span class="source-state" :class="s.state">
                {{ s.state === 'ok' ? 'merged' : s.state }}
              </span>
              <span v-if="s.reason" class="source-reason">{{ s.reason }}</span>
            </dd>
          </div>
        </dl>
        <button class="btn" :disabled="store.refreshing" @click="store.redetect()">
          Refresh detection
        </button>
      </template>
      <p v-else class="missing">ccusage was not found on this machine.</p>
    </section>

    <section class="panel">
      <h2>Float Ball</h2>
      <div class="float-settings">
        <div class="float-controls">
          <label class="float-toggle">
            <input type="checkbox" v-model="floatEnabled" @change="toggleFloat" />
            Show the floating ball on desktop
          </label>

          <div class="setting-row">
            <span class="setting-label">Shape</span>
            <div class="segmented">
              <button
                v-for="opt in shapeOptions"
                :key="opt.value"
                :class="{ active: floatConfig.shape === opt.value }"
                @click="updateFloatConfig({ shape: opt.value })"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">Size</span>
            <div class="segmented">
              <button
                v-for="opt in sizeOptions"
                :key="opt.value"
                :class="{ active: floatConfig.size === opt.value }"
                @click="updateFloatConfig({ size: opt.value })"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">Opacity</span>
            <input
              type="range"
              min="0.4"
              max="1"
              step="0.05"
              v-model.number="floatConfig.opacity"
              @change="updateFloatConfig({ opacity: floatConfig.opacity })"
            />
            <span class="setting-value">{{ Math.round(floatConfig.opacity * 100) }}%</span>
          </div>

          <div class="setting-row">
            <span class="setting-label">Animation</span>
            <div class="segmented">
              <button
                v-for="opt in animationOptions"
                :key="opt.value"
                :class="{ active: floatConfig.animation === opt.value }"
                @click="updateFloatConfig({ animation: opt.value })"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">Color</span>
            <div class="segmented">
              <button
                v-for="opt in colorModeOptions"
                :key="opt.value"
                :class="{ active: floatConfig.colorMode === opt.value }"
                @click="updateFloatConfig({ colorMode: opt.value })"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <p class="note">
            Hover the ball to see today's usage; click it to open the dashboard. Usage shape fills
            by today's tokens against historical percentiles; Quota shape fills by your tightest
            subscription window and pulses when it passes 90%.
          </p>
        </div>

        <div class="float-preview">
          <BallVisual
            :total="previewTotal"
            :tier="previewModel.tier"
            :fill-ratio="previewModel.fillRatio"
            :size="previewSize"
            :opacity="floatConfig.opacity"
            :animation="floatConfig.animation"
            :refreshing="store.refreshing"
            :shape="floatConfig.shape"
            :quota-percent="previewQuotaPercent"
          />
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>Appearance</h2>
      <div class="skin-list">
        <button
          v-for="skin in SKINS"
          :key="skin.id"
          class="skin-item"
          :class="{ active: activeSkinId === skin.id }"
          @click="setSkin(skin.id)"
        >
          <span class="skin-swatches">
            <span
              v-for="c in skin.swatches"
              :key="c"
              class="swatch"
              :style="{ background: c }"
            />
          </span>
          <span class="skin-meta">
            <span class="skin-name">{{ skin.name }}</span>
            <span class="skin-desc">{{ skin.description }}</span>
          </span>
        </button>
      </div>
      <p class="note">Applies instantly to the dashboard and the floating ball.</p>
    </section>

    <section class="panel">
      <h2>Subscriptions</h2>
      <p class="note">Quota cards and account management have moved to the Subscriptions page.</p>
      <router-link to="/subscriptions" class="btn link-btn-block">Open Subscriptions →</router-link>
    </section>

    <section class="panel">
      <h2>System</h2>
      <label class="float-toggle">
        <input type="checkbox" v-model="autoLaunch" @change="toggleAutoLaunch" />
        Launch at login
      </label>
      <p v-if="autoLaunchError" class="add-error">{{ autoLaunchError }}</p>
      <p class="note">Start the dashboard automatically when you sign in to Windows.</p>
    </section>

    <section class="panel">
      <h2>Privacy</h2>
      <p class="note">
        Local first: no login, no cloud sync, no telemetry. Usage data is read by the locally
        installed ccusage and never leaves this machine.
      </p>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

h1 {
  font-size: 20px;
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

dl {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.row {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 12px;
  font-size: 13px;
}

dt {
  color: var(--text-mute);
}

dd {
  font-variant-numeric: tabular-nums;
}

.path {
  word-break: break-all;
  color: var(--text-dim);
}

.source-state {
  font-weight: 600;
}

.source-state.ok {
  color: var(--green);
}

.source-state.skipped {
  color: var(--amber);
}

.source-state.absent {
  color: var(--text-mute);
}

.source-reason {
  margin-left: 8px;
  color: var(--text-mute);
  font-size: 12px;
}

.btn {
  background: var(--border);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}

.btn:hover {
  background: var(--border-strong);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.note {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.6;
}

.float-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 14px;
}

.float-settings {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.float-controls {
  flex: 1;
  min-width: 0;
}

.float-preview {
  /* 预览区尺寸取最大档,改大小时球在区内居中缩放 */
  width: 96px;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px dashed var(--border-strong);
  border-radius: 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 13px;
}

.setting-label {
  width: 72px;
  color: var(--text-mute);
  flex-shrink: 0;
}

.setting-value {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  width: 38px;
}

.segmented {
  display: inline-flex;
  background: var(--border);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
}

.segmented button {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.segmented button.active {
  background: var(--brand-violet);
  color: #fff;
}

input[type='range'] {
  flex: 0 1 180px;
  accent-color: var(--brand-violet);
}

.missing {
  font-size: 13px;
  color: var(--red);
}

.link-btn-block {
  display: inline-block;
  margin-top: 10px;
  text-decoration: none;
}

.add-error {
  font-size: 12px;
  color: var(--red);
}

/* ---- Appearance:皮肤列表 ---- */
.skin-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.skin-item {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--panel-sunken);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
  cursor: pointer;
  text-align: left;
  color: var(--text);
}

.skin-item:hover {
  border-color: var(--border-strong);
}

.skin-item.active {
  border-color: var(--accent);
}

.skin-swatches {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}

.swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
}

.skin-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.skin-name {
  font-size: 13px;
  font-weight: 600;
}

.skin-desc {
  font-size: 12px;
  color: var(--text-mute);
}
</style>
