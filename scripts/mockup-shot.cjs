/**
 * 设计稿渲染:npx electron scripts/mockup-shot.cjs <input.html> <output.png>
 * 以 1660x1090 视口加载本地 HTML 并截图,供 UI 方向评审。
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('usage: npx electron scripts/mockup-shot.cjs <input.html> <output.png>')
  app.exit(1)
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1660,
    height: 1090,
    show: false,
    webPreferences: { sandbox: true }
  })
  win.setMenuBarVisibility(false)
  await win.loadFile(resolve(input))
  await new Promise((r) => setTimeout(r, 1200))
  const image = await win.webContents.capturePage()
  writeFileSync(resolve(output), image.toPNG())
  console.log('saved', output)
  app.exit(0)
})
