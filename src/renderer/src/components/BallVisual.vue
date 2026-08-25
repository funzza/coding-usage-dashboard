<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue'
import { formatAxisTokens } from '../../../shared/format'
import type { UsageTier } from '../../../shared/analytics'
import type { FloatAnimation, FloatShape } from '../../../shared/float-config'
import {
  QUOTA_ALARM_COLORS,
  QUOTA_CRITICAL_PERCENT,
  QUOTA_WARN_PERCENT,
  quotaRingColor,
  type QuotaAlarmLevel
} from '../utils/ball'

/**
 * 悬浮球球体纯展示组件(FloatBall 页面与 Settings 预览共用):
 * - ball 形态:SVG 圆环填充 = 今日总量 / P90,轨道半透明灰,填充弧用档位色;quota 警示为右上角呼吸点
 * - ring 形态(配额环):环填充 = 最紧张订阅窗口的消耗百分比(quotaPercent),
 *   三档配色(绿/黄/红);≥90% 光晕呼吸脉冲预警(≥98% 加快)——预警只在环上,不发系统通知
 * - 动画语言(克制,置顶窗口不能吵):
 *   灵动模式:4s 呼吸(scale 1↔1.04)+ 8s 浮动(±3px);刷新中弧整体旋转;数据更新数字 count-up
 *   安静模式:只保留悬停反馈与数字滚动(配额预警脉冲保留——它是信息,不是装饰)
 * - 悬停弹簧放大 1.12 + 光晕增强;刷新失败轻抖
 * - 光晕用 SVG 径向渐变实现,不用 CSS filter(filter 的合成层会在透明窗口上漏出矩形亮纱)
 */
const props = withDefaults(
  defineProps<{
    /** 今日 token 总量 */
    total: number
    /** 配色档;固定品牌色模式父组件直接传 'brand' */
    tier: UsageTier
    /** 环填充比例 0..1(ball 形态用) */
    fillRatio: number
    /** 球体边长(px) */
    size: number
    /** 只作用于球体,面板不受影响 */
    opacity: number
    animation: FloatAnimation
    refreshing: boolean
    /** 刷新失败信息;变为非空时球体轻抖一下 */
    error?: string
    /** quota 警示档(>=90% 琥珀 / >=98% 红);null/缺省不显示警示点(ball 形态用) */
    alarm?: QuotaAlarmLevel | null
    /** 折叠态形态;默认 ball(经典用量环) */
    shape?: FloatShape
    /** ring 形态:最紧张订阅窗口的消耗百分比 0..100;null = 无配额数据(空灰环) */
    quotaPercent?: number | null
  }>(),
  { shape: 'ball', quotaPercent: null }
)

/** 档位配色;blazing 用渐变(弧),中心数字用渐变文字 */
const TIER_COLORS: Record<UsageTier, string> = {
  cool: '#4a9eff',
  brand: '#7c6cf8',
  warm: '#f5a35c',
  blazing: '#ff6b6b'
}

const isRing = computed(() => props.shape === 'ring')

// SVG 渐变 id 用 useId 保证唯一(FloatBall 与 Settings 预览可能同时存在)
const gradientId = `ball-blazing-${useId()}`

// ---- 圆环几何:半径 44,环粗约为半径 1/5 ----
const R = 44
const CIRCUMFERENCE = 2 * Math.PI * R

/** 生效填充比例:ring 形态改由配额百分比驱动(ball 形态沿用父组件传入的用量比例) */
const effectiveFill = computed(() => {
  if (!isRing.value) return props.fillRatio
  if (props.quotaPercent === null || props.quotaPercent === undefined) return 0
  return Math.min(1, Math.max(0, props.quotaPercent / 100))
})

const dashOffset = computed(() => CIRCUMFERENCE * (1 - effectiveFill.value))

/** ring 形态无配额数据时环体隐藏,只剩轨道 */
const hasQuotaData = computed(
  () => !isRing.value || (props.quotaPercent !== null && props.quotaPercent !== undefined)
)

const arcStroke = computed(() => {
  if (isRing.value) return quotaRingColor(props.quotaPercent ?? 0)
  return props.tier === 'blazing' ? `url(#${gradientId})` : TIER_COLORS[props.tier]
})
const glowColor = computed(() => {
  if (isRing.value) return quotaRingColor(props.quotaPercent ?? 0)
  return props.tier === 'blazing' ? '#ff8f5e' : TIER_COLORS[props.tier]
})

/** ring 形态的预警脉冲档位:≥90% 呼吸,≥98% 加快(安静模式下也保留,这是信息不是装饰) */
const ringPulse = computed<'none' | 'warn' | 'critical'>(() => {
  if (!isRing.value || props.quotaPercent === null || props.quotaPercent === undefined) return 'none'
  if (props.quotaPercent >= QUOTA_CRITICAL_PERCENT) return 'critical'
  if (props.quotaPercent >= QUOTA_WARN_PERCENT) return 'warn'
  return 'none'
})

// SVG 光晕渐变 id 同样用 useId(与 blazing 渐变共存)
const haloId = `ball-halo-${useId()}`

// ---- 中心数字:随尺寸缩放,count-up 滚动 ----
const fontSize = computed(() => Math.max(10, Math.round(props.size * 0.205)))

const displayed = ref(props.total)
let countRaf: ReturnType<typeof requestAnimationFrame> | null = null

watch(
  () => props.total,
  (next, prev) => {
    if (countRaf) cancelAnimationFrame(countRaf)
    const from = prev ?? 0
    const start = performance.now()
    const step = (t: number): void => {
      const k = Math.min(1, (t - start) / 600)
      // ease-out,滚动后段减速
      displayed.value = Math.round(from + (next - from) * (1 - (1 - k) ** 3))
      if (k < 1) countRaf = requestAnimationFrame(step)
    }
    countRaf = requestAnimationFrame(step)
  }
)

const valueText = computed(() => formatAxisTokens(displayed.value))

// ---- 刷新失败:轻抖一下(±2px 两次)----
const shaking = ref(false)
let shakeTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.error,
  (next, prev) => {
    if (!next || next === prev) return
    shaking.value = false
    // 强制重启动画
    requestAnimationFrame(() => {
      shaking.value = true
      if (shakeTimer) clearTimeout(shakeTimer)
      shakeTimer = setTimeout(() => {
        shaking.value = false
      }, 500)
    })
  }
)

onUnmounted(() => {
  if (countRaf) cancelAnimationFrame(countRaf)
  if (shakeTimer) clearTimeout(shakeTimer)
})
</script>

<template>
  <div
    class="ball-visual"
    :class="[animation, { refreshing, shaking, 'ring-pulse': ringPulse !== 'none', critical: ringPulse === 'critical' }]"
    :style="{ width: `${size}px`, height: `${size}px`, opacity }"
  >
    <div class="hover-zoom">
      <div class="breathe">
        <div class="float-y">
          <svg class="ring" viewBox="0 0 100 100">
            <defs>
              <linearGradient :id="gradientId" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stop-color="#ff6b6b" />
                <stop offset="100%" stop-color="#ffd166" />
              </linearGradient>
              <!-- 光晕:径向渐变在环半径处形成光带,两端渐变到全透明。
                   不用 CSS drop-shadow:filter 会强制 GPU 合成层,
                   在透明窗口上漏出矩形亮纱(黑底可见的"框") -->
              <radialGradient :id="haloId" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="50">
                <stop offset="0%" :stop-color="glowColor" stop-opacity="0" />
                <stop offset="70%" :stop-color="glowColor" stop-opacity="0" />
                <stop offset="84%" :stop-color="glowColor" stop-opacity="0.5" />
                <stop offset="100%" :stop-color="glowColor" stop-opacity="0" />
              </radialGradient>
            </defs>
            <!-- 光晕层:opacity 过渡不产生 filter 合成层;ring 预警时呼吸脉冲 -->
            <circle class="halo" cx="50" cy="50" r="50" :fill="`url(#${haloId})`" />
            <!-- 底色轨道 -->
            <circle class="track" cx="50" cy="50" :r="R" />
            <!-- 填充弧:12 点方向起,刷新中整环缓慢旋转;ring 形态无配额数据时隐藏 -->
            <g v-if="hasQuotaData" class="arc-rot">
              <circle
                class="arc"
                cx="50"
                cy="50"
                :r="R"
                :stroke="arcStroke"
                :stroke-dasharray="CIRCUMFERENCE"
                :stroke-dashoffset="dashOffset"
                transform="rotate(-90 50 50)"
              />
            </g>
          </svg>
          <span
            class="value"
            :class="{ blazing: !isRing && tier === 'blazing' }"
            :style="{ fontSize: `${fontSize}px`, color: glowColor }"
          >{{ valueText }}</span>
          <!-- quota 警示点(ball 形态):右上角呼吸圆点;发光用 box-shadow,只作用于这个圆形元素,
               不给容器加背景/filter(透明窗口上会漏出矩形边界,同 halo 注释)。
               ring 形态由环体自身的脉冲承担预警,不重复显示 -->
          <span
            v-if="alarm && !isRing"
            class="alarm-dot"
            :style="{
              background: QUOTA_ALARM_COLORS[alarm],
              boxShadow: `0 0 6px 1px ${QUOTA_ALARM_COLORS[alarm]}`
            }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ball-visual {
  position: relative;
  cursor: pointer;
  user-select: none;
}

.hover-zoom {
  width: 100%;
  height: 100%;
  /* 弹簧感放大 */
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ball-visual:hover .hover-zoom {
  transform: scale(1.12);
}

.breathe,
.float-y {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 灵动模式:呼吸 + 浮动叠加;安静模式都不开 */
.lively .breathe {
  animation: breathe 4s ease-in-out infinite;
}

.lively .float-y {
  animation: floaty 8s ease-in-out infinite;
}

/* 刷新失败轻抖(两种动画模式都保留) */
.shaking .float-y {
  animation: shake 0.5s ease-in-out;
}

/* ring 形态预警:光晕呼吸脉冲(信息性,安静模式也保留);critical 加快一倍 */
.ring-pulse .halo {
  animation: halo-pulse 2.2s ease-in-out infinite;
}

.ring-pulse.critical .halo {
  animation-duration: 1.1s;
}

@keyframes halo-pulse {
  0%,
  100% {
    opacity: 0.2;
  }
  50% {
    opacity: 1;
  }
}

.ring {
  position: absolute;
  /* 窗口边长即球体尺寸:留 16% 余量给呼吸/悬停放大(1.04×1.12≈1.16),否则会被窗口裁掉 */
  inset: 8%;
  width: 84%;
  height: 84%;
  /* 让光晕能渲染到 SVG 视口外 */
  overflow: visible;
}

/* 光晕:常时收敛,悬停增强;纯 opacity 过渡 */
.halo {
  opacity: 0.55;
  transition: opacity 0.5s ease;
}

.ball-visual:hover .halo {
  opacity: 1;
}

.track {
  fill: none;
  stroke: rgb(255 255 255 / 14%);
  stroke-width: 9;
}

.arc {
  fill: none;
  stroke-width: 9;
  stroke-linecap: round;
  /* 档间配色与填充比例都平滑过渡 */
  transition:
    stroke 0.6s ease,
    stroke-dashoffset 0.6s ease;
}

.arc-rot {
  transform-origin: 50% 50%;
}

/* 刷新中:填充弧整体缓慢旋转(安静模式关掉) */
.lively.refreshing .arc-rot {
  animation: arc-spin 1.8s linear infinite;
}

.value {
  position: relative;
  font-weight: 700;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  transition: color 0.6s ease;
}

/* 炽红金档:中心数字也用渐变 */
.value.blazing {
  background: linear-gradient(45deg, #ff6b6b, #ffd166);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent !important;
}

/* quota 警示点:环 45° 右上角外侧(环中心 50% / 半径 42%,45° ≈ ±29.7%),随呼吸/浮动一起动 */
.alarm-dot {
  position: absolute;
  left: 81%;
  top: 19%;
  width: 15%;
  aspect-ratio: 1;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  animation: alarm-pulse 2.2s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.04);
  }
}

@keyframes floaty {
  0%,
  100% {
    transform: translateY(-3px);
  }
  50% {
    transform: translateY(3px);
  }
}

@keyframes arc-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes alarm-pulse {
  0%,
  100% {
    opacity: 0.55;
    scale: 0.85;
  }
  50% {
    opacity: 1;
    scale: 1.15;
  }
}

@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-2px);
  }
  40% {
    transform: translateX(2px);
  }
  60% {
    transform: translateX(-2px);
  }
  80% {
    transform: translateX(2px);
  }
}
</style>
