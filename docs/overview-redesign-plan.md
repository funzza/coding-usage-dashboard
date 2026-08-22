# Overview 重构实施计划（已定稿）

> 目的：防止长任务信息丢失。本文档囊括本次产品讨论的全部结论，实施时以此为准。
> 例图：`mockups/d-overview-today.png` / `mockups/d-overview-30d.png`（仅为功能模块示意，最终 UI 要更精细，配色用应用真实调色板）。

## 一、核心问题诊断（审查结论）

1. Today 视图真重复：rank chart 与明细列表是同一数据的两种横条图。
2. By Agent/By Model 开关藏在趋势面板却控制明细列表——隐性耦合。
3. RangeTabs 与趋势图内 Day/Week/Month 两个时间控件职责不清。
4. Today 缺参照系：usageMilestones 已算出 median/p75/p90 但只用于悬浮球配色。
5. 视觉手段单调：三处全是水平横条。
6. 明细横条齐平（CompositionBar 恒满宽），看不出量级差距——缺陷，必修。
7. 30D 信息密度不足。
8. 侧栏固定 Today 语义是对的（快速看板），保留不动。

## 二、信息架构定稿

### 页级控制（Overview 头部）
- `RangeTabs`(Today/7D/30D/All)：全局唯一时间上下文，驱动整页。
- `DimensionTabs`(By Agent/By Model)：提升为页级开关，与 RangeTabs 并列放头部；控制趋势图、donut、drift、明细列表。存 pinia(`store.dimension`,默认 'agents')，跨页面导航保持。

### Today 布局（自上而下）
1. Hero：大数字 + 成本 + New/Cached + 构成条 + Cached Input Share。
2. **milestone 行**（仅 Today):tier 文案 + `median X · p75 Y · p90 Z`。
   - tier 文案：cool='A quiet day',brand='Around your typical day',warm='Above your typical day',blazing='Well above your typical day'。
   - warm/blazing 用 --amber 着色 tag；cool/brand 用普通 dim。不做红绿褒贬。
3. Subscriptions（不变）。
4. **Today's Activity 24h 图**（新增）：x=24 小时，堆叠柱；By Agent 时柱内按 agent 分色，By Model 时按 model(top5+Other)。悬停显示该小时明细。
   - 数据口径：session 的 lastActivity(UTC ISO→本地小时）归档，图下注明 "Sessions attributed to their last-activity hour"。
   - 数据源：复用 `usage:sessions` IPC；新建 renderer `stores/sessions.ts`(5 分钟 TTL、防并发、失败静默),Overview 仅 Today 态懒加载；Sessions.vue 一并改为消费该 store，避免重复 spawn。
5. **ShareDonut + 明细列表并排**(grid 340px 1fr)：中心今日总量；明细列表等比横条。

### 区间布局（7D/30D/All 共用同一模板，自上而下）
1. Hero（同 Today，无 milestone 行）。
2. **Stats strip**（新增，4 项）:Avg/Day、Busiest Day（日期+值）、Active Days(n/days)、vs Prev（环比）。
   - 环比 = 当前窗口总量 vs 紧前等长窗口总量；Today 比昨天；All 无 → 隐藏；上一周期无数据/为 0 → 隐藏。
   - ▲▼ 中性着色（--amber 或 text)，不用红绿褒贬。
3. Subscriptions。
4. Daily Usage 趋势（现有堆叠柱）:
   - 粒度开关降级为图右上角小控件；默认值随 range:7D/30D→Day,All→Week；用户可手动覆盖；range 变化时重置为默认。
   - **柱宽自适应**（用户明确要求）：桶多细柱、桶少粗柱。DailyBarChart 动态 barMaxWidth:n≤8→28,n≤16→16，否则→8。HourlyActivity(24 桶）同理细柱。
5. **Share Drift + Weekday Rhythm 并排**(grid 3fr 2fr):
   - Share Drift:100% 堆叠面积图，top5+Other，随 DimensionTabs 切换 agent/model；粒度跟随趋势默认（7D/30D 按天，All 按周 bucket 后再算 share)。0 总量日各系列 share=0。
   - Weekday Rhythm：周一~周日日均，7 柱，最大值用 --accent 高亮，其余 muted。
   - 7D 下 Weekday Rhythm 退化为单日值（信息量低但不出错），保留不隐藏——模板统一性优先。
6. 明细列表：等比横条收尾。

### 明细横条等比化（全站）
- CompositionBar 增加可选 prop `maxTokens`；提供时外层 track 满宽淡色垫底（--divider)，内层条宽 = total/max×100%(>0 时 min 约 2% 保可见）。
- 生效页面：Overview、AgentDetail、ModelDetail。不传 maxTokens 的旧用法（HeroStats 等）行为不变。

### 详情页同构（AgentDetail / ModelDetail）
- Today:Hero + milestone（按该实体自己的日序列算，用新 `milestonesOf(totals[])`)→ donut(agent 页=其 models;model 页=其 agents)+ 明细列表（等比）。
- 区间：Hero → 趋势（TrendChart 传 range prop)→ 明细列表（等比）。**不上** stats strip / drift / rhythm（本轮范围控制，仅 Overview)。
- donut 取代 CompositionRankChart;**删除 CompositionRankChart.vue**（死代码）。

## 三、数据层（全部现有 snapshot/session 可算，主进程零改动）

`src/shared/analytics.ts` 新增纯函数 + 完整 vitest:

```ts
export interface Milestones { median: number; p75: number; p90: number }
export function milestonesOf(totals: number[]): Milestones | null   // usageMilestones 内部改用它,签名不变

export interface RangeStats {
  days: number            // 窗口天数(all=实际跨度)
  activeDays: number      // totalTokens>0
  avgPerDay: number
  busiestDay: { date: string; totalTokens: number } | null
  prevDelta: number | null
}
export function rangeStats(daily: DailyUsage[], range: RangeKey, now?: Date): RangeStats

export interface WeekdayAvg { dow: number; avg: number }  // dow 0=周一..6=周日(与 isoWeekStart 约定一致)
export function weekdayAverages(filledDaily: DailyUsage[]): WeekdayAvg[]   // 输入为补零后的区间 daily

export interface ShareDrift { dates: string[]; names: string[]; shares: number[][] }  // shares[i] 对应 names[i],0..100
export function shareDrift(filledDaily: DailyUsage[], mode: 'agents' | 'models', topN = 5): ShareDrift

export interface HourBucket { hour: number; totalTokens: number; agents: Record<string, number>; models: Record<string, number> }
export function sessionsHourlyBuckets(sessions: SessionUsage[], date: string): HourBucket[]  // 恒 24 项;date=本地 YYYY-MM-DD
```

时区：lastActivity 用 `new Date(iso)` 转本地取小时与日期。
测试注意 TZ 无关性：用 `new Date(y,m,d,h).toISOString()` 构造。

## 四、文件改动清单

新增：
- `src/renderer/src/charts/ShareDonut.vue`(props: items: RankItem[], centerLabel, centerValue, centerSub?;echarts pie radius ~['62%','80%'];中心用 HTML 覆盖层拿皮肤 token;tooltip 显示 name/tokens/pct)
- `src/renderer/src/charts/ShareDriftChart.vue`(props: days, mode)
- `src/renderer/src/charts/WeekdayRhythmChart.vue`(props: days)
- `src/renderer/src/charts/HourlyActivityChart.vue`(props: buckets, mode;注口径小字)
- `src/renderer/src/components/StatsStrip.vue`(props: stats: RangeStats, rangeLabel)
- `src/renderer/src/components/DimensionTabs.vue`（样式同 RangeTabs，绑 store.dimension)
- `src/renderer/src/stores/sessions.ts`(TTL 5min、防并发、applyResult 式容错）

修改：
- `src/shared/analytics.ts`(+测试 analytics.test.ts)
- `src/renderer/src/components/CompositionBar.vue`(maxTokens prop)
- `src/renderer/src/components/HeroStats.vue`(milestone 行，可选 props: milestones, todayTotal)
- `src/renderer/src/charts/TrendChart.vue`(range prop → 粒度默认+重置；开关视觉降级)
- `src/renderer/src/charts/DailyBarChart.vue`（柱宽自适应）
- `src/renderer/src/stores/usage.ts`(dimension 字段）
- `src/renderer/src/pages/Overview.vue`（两套布局重构）
- `src/renderer/src/pages/AgentDetail.vue` / `ModelDetail.vue`（同构）
- `src/renderer/src/pages/Sessions.vue`（改消费 sessions store)

删除：`src/renderer/src/charts/CompositionRankChart.vue`。

## 五、UI 精细度要求（用户反馈）

- 例图仅功能示意；落地用应用真实调色板（agentColor/seriesColor/COMPOSITION_SEGMENTS tokens)，杜绝例图里的屎黄色。
- 所有 echarts 组件沿用现有约定：touch activeSkinId + cssToken 解析具体色值（canvas 不认 var())。
- CSS 全部走 CSS 变量；focus/classic 双皮肤都要正常；focus 下新区块沿用去盒子化（hairline、小标题、大留白）。
- 柱宽自适应（见二.4)。
- tooltip 统一现有风格（--tooltip-bg/border、formatTokens + 完整整数）。

## 六、验证

1. `npm run typecheck` 干净。
2. `npx vitest run` 全绿（含新增 analytics 测试；集成测试 ~100s 正常）。
3. `npm run screenshot`(150s 首刷等待）+ 必要的手动截图：Today 态、30D 态、7D、All、By Model、AgentDetail、ModelDetail、classic 皮肤同款。
4. ReadMediaFile 逐张自查后汇报。

## 七、明确不做

- 不解析原始 agent 日志（24h 图用 session lastActivity 口径，如实标注）。
- agent×model 交叉矩阵、搜索、折线趋势、hourly 精确计量——以后再说。
- 详情页不上 stats strip/drift/rhythm（本轮）。
- 侧栏、Subscriptions 结构、悬浮球不动。
