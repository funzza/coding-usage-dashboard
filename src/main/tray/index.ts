import { BrowserWindow, Menu, Tray, app, nativeImage, type NativeImage } from 'electron'
import { formatTokens } from '../../shared/format'
import { agentKeyOf, displayAgentKey } from '../../shared/agents'
import { refreshUsage } from '../usage/service'
import type { UsageSnapshot } from '../../shared/usage-model'
import { isFloatEnabled, setFloatEnabled } from '../float'

let tray: Tray | null = null

/** 程序化生成 16x16 柱状图图标(BGRA),避免引入图标资源文件 */
function createTrayIcon(): NativeImage {
  const size = 16
  const buffer = Buffer.alloc(size * size * 4, 0)
  // 三根柱子:x 区间 + 高度,青色
  const bars: Array<[number, number, number]> = [
    [2, 5, 7],
    [7, 10, 11],
    [12, 15, 15]
  ]
  for (const [x0, x1, h] of bars) {
    for (let y = size - h; y < size - 1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4
        buffer[i] = 0xd1 // B
        buffer[i + 1] = 0x8b // G
        buffer[i + 2] = 0x45 // R
        buffer[i + 3] = 0xff // A
      }
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size })
}

export function createTray(getWindow: () => BrowserWindow | null): void {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('Coding Usage Dashboard')
  updateTrayMenu(null, getWindow)
  tray.on('click', () => showWindow(getWindow))
}

export function updateTrayMenu(snapshot: UsageSnapshot | null, getWindow: () => BrowserWindow | null): void {
  if (!tray) return

  const template: Electron.MenuItemConstructorOptions[] = []

  if (snapshot) {
    template.push({ label: `Today   ${formatTokens(snapshot.today.totalTokens)}`, enabled: false })
    const todayAgents = snapshot.daily[snapshot.daily.length - 1]?.agents ?? []
    for (const agent of todayAgents.slice(0, 5)) {
      template.push({
        label: `${displayAgentKey(agentKeyOf(agent))}   ${formatTokens(agent.totalTokens)}`,
        enabled: false
      })
    }
    template.push({ type: 'separator' })
  }

  template.push(
    { label: 'Refresh', click: () => void refreshUsage() },
    { label: 'Open Dashboard', click: () => showWindow(getWindow) },
    {
      label: 'Float Ball',
      type: 'checkbox',
      checked: isFloatEnabled(),
      click: (item) => setFloatEnabled(item.checked)
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.exit(0) }
  )

  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function showWindow(getWindow: () => BrowserWindow | null): void {
  const win = getWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
