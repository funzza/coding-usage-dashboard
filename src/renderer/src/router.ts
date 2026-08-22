import { createRouter, createWebHashHistory } from 'vue-router'
import AgentDetail from './pages/AgentDetail.vue'
import FloatBall from './pages/FloatBall.vue'
import ModelDetail from './pages/ModelDetail.vue'
import Overview from './pages/Overview.vue'
import Sessions from './pages/Sessions.vue'
import Settings from './pages/Settings.vue'
import Subscriptions from './pages/Subscriptions.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'overview', component: Overview },
    // Sessions 页进入时才触发 ccusage session 调用(单次可能 1-2 分钟)
    { path: '/sessions', name: 'sessions', component: Sessions },
    // quota 完整卡片 + 账号管理(Overview 只有速览 strip)
    { path: '/subscriptions', name: 'subscriptions', component: Subscriptions },
    { path: '/agents/:name', name: 'agent', component: AgentDetail, props: true },
    // 模型名可能含 '/'(如 alibaba-token-plan-cn/deepseek-v4-flash-0731),
    // 路径参数会被斜杠拆段,一律走 query:?name=
    { path: '/model', name: 'model', component: ModelDetail },
    { path: '/settings', name: 'settings', component: Settings },
    // 悬浮球窗口专用页:无侧边栏、透明背景
    { path: '/float', name: 'float', component: FloatBall },
    // 未匹配路由回 Overview,避免 router-view 渲染空白
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})
