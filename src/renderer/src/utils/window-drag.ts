/**
 * 无边框主窗口的手动拖拽。
 *
 * 背景:CSS `-webkit-app-region: drag` 在本机实测不生效(computed style 正确但拖不动),
 * 所以用指针事件 + IPC 手动 setPosition,与悬浮球同一套验证过的实现。
 * 与 app-region 不冲突:原生拖拽若生效,OS 在命中测试阶段就拿走鼠标事件,
 * 页面收不到 pointerdown,这套代码自然不会触发。
 *
 * 机制:document 级事件代理,命中 .drag-region/.drag-head(且不是交互控件)即开始拖拽;
 * pointer capture 保证光标移出窗口后事件仍持续到达;双击拖拽区切换最大化。
 */

const DRAG_SELECTOR = '.drag-region, .drag-head'
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, label, .no-drag'

let dragging = false

function dragRegionOf(target: EventTarget | null): HTMLElement | null {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return null
  if (el.closest(INTERACTIVE_SELECTOR)) return null
  return el.closest(DRAG_SELECTOR) as HTMLElement | null
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || dragging) return
  const region = dragRegionOf(event.target)
  if (!region) return
  dragging = true
  try {
    region.setPointerCapture(event.pointerId)
  } catch {
    // 捕获失败无碍:窗口内移动仍会收到事件
  }
  window.usageApi.windowDragStart(event.screenX, event.screenY)
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return
  window.usageApi.windowDragMove(event.screenX, event.screenY)
}

function onPointerUp(): void {
  if (!dragging) return
  dragging = false
  window.usageApi.windowDragEnd()
}

function onDblClick(event: MouseEvent): void {
  if (!dragRegionOf(event.target)) return
  window.usageApi.toggleMaximize()
}

/** 挂上全局拖拽代理;返回解绑函数 */
export function initWindowDrag(): () => void {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerUp)
  document.addEventListener('dblclick', onDblClick)
  return () => {
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)
    document.removeEventListener('dblclick', onDblClick)
  }
}
