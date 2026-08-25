/**
 * 生成应用图标:离屏渲染品牌圆环(与悬浮球同款)到 resources/icon.png(512x512,透明角)。
 * 独立脚本,不依赖 dev server / out 构建。用法:npx electron scripts/icon-shot.cjs
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = 512

// 品牌图形:深色圆角底板 + 紫罗兰进度环(72% 弧),与悬浮球/默认皮肤 accent 一致
const html = `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box }
  body { width: ${SIZE}px; height: ${SIZE}px; background: transparent; display: grid; place-items: center }
  svg { display: block }
</style></head><body>
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="ring" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#6a5cff"/>
      <stop offset="1" stop-color="#b48cff"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="14" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="#0d0f13"/>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="#23262e" stroke-width="3"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#262a33" stroke-width="46"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="url(#ring)" stroke-width="46"
          stroke-linecap="round" stroke-dasharray="678.6 942.5"
          transform="rotate(126 256 256)" filter="url(#glow)"/>
</svg>
</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 800))
  const image = await win.webContents.capturePage()
  const outDir = join(__dirname, '..', 'resources')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'icon.png'), image.toPNG())
  console.log('saved resources/icon.png')
  app.exit(0)
})
