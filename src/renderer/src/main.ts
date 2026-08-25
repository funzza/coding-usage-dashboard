import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { use } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { LegacyGridContainLabel } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import App from './App.vue'
import { router } from './router'
import { applySkin, loadStoredSkinId } from '../../shared/skins'
import { syncTitlebarOverlay } from './utils/skin'
import './style.css'
import './skins.css'

// 创建 Vue app 之前同步应用皮肤,避免启动闪烁(主窗口/悬浮球共享 localStorage)
const initialSkin = loadStoredSkinId()
applySkin(initialSkin)
// 无边框窗口的 caption overlay 配色跟随当前皮肤
syncTitlebarOverlay(initialSkin)

use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, LegacyGridContainLabel, CanvasRenderer])

const app = createApp(App)
// 渲染错误打到 console(截图工具会转发),不要让组件错误无声黑屏
app.config.errorHandler = (err) => {
  console.error('[vue-error]', err)
}
app.use(createPinia()).use(router).mount('#app')
