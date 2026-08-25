# Coding Usage Dashboard

[English](README.en.md) | 简体中文

Windows 本地 AI Coding 用量仪表盘。以本机已安装的 [ccusage](https://github.com/ccusage/ccusage) 为主要数据引擎，同时直读 ZCode / DSH / Qoder，并并行采集 **WSL 默认发行版** 内的用量。打开即看，不用再记 CLI 命令。

**仅支持 Windows 10/11。** 全部计算在本机完成，无遥测、无上报。

这是作者自用工具开源出来的，不是完整产品。订阅、Agent、图表口径都按「我这台机器用得到的」实现，缺的请自己（或丢给 AI）按下面的扩展点补。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6.svg)](https://github.com/funzza/coding-usage-dashboard/releases)
[![Release](https://img.shields.io/github/v/release/funzza/coding-usage-dashboard?include_prereleases)](https://github.com/funzza/coding-usage-dashboard/releases)

![Overview](docs/images/overview-today.png)

## 功能

- **多 Agent 用量聚合**：ccusage 扫到的 harness + 三套本地直读适配器，统一成一套数据模型
- **WSL 用量接入**：并行跑 WSL 内的 ccusage；WSL 侧以 `Claude (WSL)` 等独立条目展示。未装则自动缺席
- **订阅额度监控**：Kimi / ChatGPT / OpenCode Go / Grok（作者只有这几家），120s 轮询，超限预警
- **多时间维度**：Today / Weekly / Monthly / All
- **Sessions**：按会话看明细（只覆盖 ccusage 的 session 报告）
- **桌面悬浮球**：今日用量外显，悬停展开，单击唤起主窗口
- **六套皮肤**：Focus / Classic / Paper / Mono / Neon / Blueprint
- 系统托盘、开机自启、5 分钟自动刷新、无边框窗口

| Sessions                              | 订阅额度                                            | 悬浮球                             |
| ------------------------------------- | ----------------------------------------------- | ------------------------------- |
| ![Sessions](docs/images/sessions.png) | ![Subscriptions](docs/images/subscriptions.png) | ![Float](docs/images/float.png) |

| Paper                                | Mono                               | Neon                               | Blueprint                                    |
| ------------------------------------ | ---------------------------------- | ---------------------------------- | -------------------------------------------- |
| ![Paper](docs/images/skin-paper.png) | ![Mono](docs/images/skin-mono.png) | ![Neon](docs/images/skin-neon.png) | ![Blueprint](docs/images/skin-blueprint.png) |

## 支持哪些 Agent

### 1. 走 ccusage（动态发现）

`ccusage daily --json --by-agent` 报什么，侧栏就显示什么。本仓库不维护名单。作者本机出现过：

Claude · Codex · Kimi · Grok · OpenCode · Pi

你还用 Gemini / 别的 harness，只要当前安装的 ccusage 能扫到，就会作为独立 Agent 出现，一般不用改这个仓库。ccusage 升了级、多覆盖一家，刷新即可。

### 2. 本仓库自己写的本地适配器

ccusage 覆盖不到的，才在这里手写读取。失败是 fail-soft：缺文件、schema 变了，只在 Settings 标状态，不拖垮主链路。

| Agent     | 数据位置                                    | Windows | WSL              | 金额 `$` | Sessions 页 / Today 柱状图 |
| --------- | --------------------------------------- | ------- | ---------------- | ------ | ---------------------- |
| **ZCode** | `~/.zcode/cli/db/db.sqlite`             | 有       | 有（UNC 读 WSL 家目录） | 无，恒 0  | **无**（只有按日聚合）          |
| **DSH**   | `~/.dsh/sessions/**/session.jsonl.zstd` | 有       | 有                | 无，恒 0  | **无**                  |
| **Qoder** | `%APPDATA%/QoderCN/.../local.db`        | 有       | **无**            | 无，恒 0  | **无**                  |

以后 ccusage 若开始统计同名 agent，本地适配器会自动让位（`covered by ccusage`），避免双算。

## 订阅额度：只有作者有的那几家

额度监控和用量 Agent 是分开的。用量可以「ccusage 报什么显示什么」；额度必须对接各家未文档化的接口，**没账号就没法写、没法测**。所以目前只有：

| 订阅              | 本机凭据                                       | 多账号粘贴 token | WSL                 |
| --------------- | ------------------------------------------ | ----------- | ------------------- |
| Kimi            | 本机 `kimi web`（`~/.kimi-code/server.token`） | 无（走本地服务）    | 有（`local-wsl:kimi`） |
| ChatGPT / Codex | `~/.codex/auth.json`                       | 有           | 无                   |
| OpenCode Go     | OpenCode `auth.json` 里的 `opencode-go.key`  | 有           | 无                   |
| Grok            | `~/.grok/auth.json`                        | 有           | 无                   |

**没有做**（不是做不到，是作者没有这些订阅）：Claude Max/Pro 额度、Gemini、GitHub Copilot、Cursor、阿里 Token Plus，以及任何其他家。

额度端点是各 CLI 自己在用的接口，不是稳定公开 API。变了会降级成 error / 空窗口，不会把应用打崩。Token 用 Windows DPAPI 加密落盘，只在主进程解密。

## 已知问题与局限

请先看完再决定要不要用、要不要改。下面这些是当前设计如此，不是「暂时忘了写进 UI」。

1. **Today 的柱状图不是按小时切开的真实消耗。**  
   数据来自 `ccusage session`，每个 session 的 **全部 token** 记在 `lastActivity`（最后活动时间）所在的本地小时。一场从 9 点开到 17 点的长会话，会在 17 点那根柱上一次性冒出来，中间几小时是空的。图下那句 *Sessions attributed to their last-activity hour; long sessions count at completion time.* 说的就是这个。  
   进行中的会话：日常顶部的 Today 总数来自 `ccusage daily`，往往已经在涨；柱状图要等 session 报告里出现该会话。常见观感就是「会话结束（或 ccusage 写出 lastActivity）之后才记上一柱」。没有 `lastActivity` 的行直接丢弃。

2. **Today 顶部数字和柱状图对不齐是预期行为。**  
   顶部 Totals / 饼图来自 `daily`（含 ZCode / DSH / Qoder）；柱状图来自 `session`（**不含** 这三家）。两套命令、两套缓存（session 还要 1–2 分钟、5 分钟 TTL），对不齐不要当 bug 修掉——要修的话先改口径。

3. **Sessions 页同样只有 ccusage 的会话。**  
   ZCode / DSH / Qoder 没有 session 适配器，列表里不会出现它们。

4. **订阅很少。** 见上一节。想加家，走「接着改」里的额度扩展，并自备可登录的账号。

5. **金额 `$` 不完整。** 只有 ccusage 给的估算。ZCode / DSH / Qoder 的 `totalCost` 恒为 0，所以总金额会偏低。

6. **只采 WSL 默认发行版**，不会遍历你装的每一个 distro。Qoder 没有 WSL 适配。

7. **刷新慢、刷新少。** 一次 `ccusage daily` 经常十几秒，session 可能 1–2 分钟；自动刷新 5 分钟一次，额度 120 秒一次。主进程有单飞守卫，不会并行打爆 ccusage。

8. **Kimi 额度依赖本机 `kimi web` 在跑。** Grok 的 JWT 大约 6 小时过期，过期后需要再开一次 Grok CLI 让它刷新，应用不会自己做 OAuth。

9. **Windows only，安装包未代码签名，也没有自动更新。** SmartScreen 可能拦一次。macOS / Linux 不能装——主进程用了 `where.exe`、DPAPI、HKCU、WSL UNC。

还有一些作者自己也不完全确定的行为，取决于上游：ccusage 何时把进行中的 session 写进 `session --json`、各家额度窗口字段何时改名、ZCode/DSH/Qoder 下次升库会不会把 schema 改到被守卫跳过。Settings 页的数据源状态行是看这些的地方。

## 安装

### 1. 安装 ccusage（应用不自带）

```powershell
npm install -g ccusage
```

未检测到时应用只给引导页，不会下载或锁定 ccusage 版本。

### 2. 下载安装包

到 [Releases](https://github.com/funzza/coding-usage-dashboard/releases) 下载 `coding-usage-dashboard-setup-x.y.z.exe`，双击安装。单用户、无需管理员。未签名：SmartScreen 选「仍要运行」。

### 3. 可选：WSL 用量

在 **默认发行版** 里装（不要装到 `/mnt/c`）：

```bash
npm install -g --prefix ~/.local ccusage
```

把 `~/.local/bin` 放进 PATH。Windows / WSL 分开计数，界面用 All / Win / WSL 切。

### 4. 可选：订阅额度

登录过对应 CLI 即可。ChatGPT / OpenCode Go / Grok 也能在 Subscriptions 页粘贴 token 加多账号。

## 它是怎么做的

三层，契约只有一份。Renderer 不碰文件系统、不碰 token、不 spawn 进程。

```
Vue 3 UI  (src/renderer)
    │  IPC（preload 白名单）
    ▼
Electron main
    ├─ src/main/usage/service.ts     编排：定位 ccusage → 跑 JSON → 合并额外源
    │     ├─ ccusage/                Windows: daily / session
    │     ├─ wsl/                    默认发行版里再跑一遍，agent 打 origin=wsl
    │     ├─ zcode/  dsh/  qoder/    EXTRA_SOURCES[] 注册的本地适配器
    │     └─ 全部 fail-soft 合并进 UsageSnapshot
    └─ src/main/quota/service.ts     PROVIDERS[] 注册表，120s 轮询
          token 只在主进程；DPAPI 加密落盘

src/shared/usage-model.ts   归一化模型（DailyUsage / SessionUsage / SourceStatus）
src/shared/analytics.ts     图表口径的纯函数（含 Today 按 lastActivity 分桶）
src/shared/agents.ts        agent key ↔ 显示名（kimi@wsl → "Kimi (WSL)"）
```

刷新时主进程只 spawn **一个** Windows ccusage；WSL 那侧并行。额外源在快照之后同步合并。ccusage 将来覆盖了同名 agent，本地源自动 `skipped`。

额度是另一条链路：读本机凭据 → 打各家用量接口 → 解析成 `QuotaWindow[]`（百分比 + 重置时间）。解析按「字段可能缺失」写，schema 漂了就空着，不抛。

UI 只消费 snapshot。换皮肤是 `src/shared/skins.ts` 的 CSS 变量 + `skins.css` 里 `[data-skin]` 覆写。

## 拿这份代码继续让 AI 开发

这仓库就是按「给人（和模型）接着改」排的：适配器一个目录一家、注册表集中、归一化模型不许适配器泄漏到 Vue。把下面整段连同你的目标贴进 AI 即可。

建议先让它读：

- `src/shared/usage-model.ts` — 所有适配器的输出契约
- `src/main/usage/service.ts` — `EXTRA_SOURCES` / `wslFileSources` / `doGetSessions`
- `src/main/zcode/` — 本地用量适配器样板（reader + adapter + fail-soft `collect*`）
- `src/main/quota/service.ts` 的 `PROVIDERS`，以及 `src/main/quota/grok.ts` 或 `codex.ts`
- `src/renderer/src/pages/Subscriptions.vue` 的 `PROVIDER_META`（额度 UI 名单）
- `src/shared/skins.ts` + `src/renderer/src/skins.css`

硬约束（违反就会把数据弄脏或把 token 送进渲染进程）：

- 适配器失败必须返回 `{ daily: null, status: { state: 'skipped' | 'absent', reason } }`，禁止 throw 阻断 ccusage
- 原始 JSON/SQLite schema 留在该 adapter 目录；`renderer/` 只能 import `shared/`
- 额度 token 不准出现在 IPC 视图、日志、Vue；明文只在 main 采集那一瞬间
- 不要为了「柱状图好看」去改 daily 数字；Today 柱的口径在 `sessionsHourlyBuckets`（`src/shared/analytics.ts`）

### 加一个 ccusage 没有的 Agent

1. 复制 `src/main/zcode/` 为新目录：`reader.ts` 找文件/查库，`adapter.ts` 变成 `DailyUsage[]`，`index.ts` 做 fail-soft `collect*`
2. 在 `usage/service.ts` 的 `EXTRA_SOURCES` 注册 Windows；若 WSL 家目录也有数据，再注册 `wslFileSources`
3. 显示名补到 `src/shared/agents.ts` 的 `DISPLAY_NAMES`
4. 单测仿 `zcode/adapter.test.ts`；本机有库时的 integration 用 `describe.skipIf`
5. **Sessions / Today 柱状图默认不会出现这家。** 要出现，还得产出 `SessionUsage[]` 并在 `doGetSessions` 里合并（现在三家本地源都没做）
6. 金额：自己按定价算，或继续填 0

### 加一家订阅额度

1. 复制 `src/main/quota/grok.ts`：读凭据、打接口、解析成 `QuotaWindow[]`
2. 把 id 加进 `QuotaProviderId`，在 `PROVIDERS` 注册，在 `Subscriptions.vue` 的 `PROVIDER_META` 加一行
3. 需要自己的登录态才能测。作者加不了没订阅的家
4. 不要自己实现 OAuth refresh（和 CLI 抢写凭据文件会冲突）；401 就提示用户去开一次官方 CLI

### 改 Today 柱状图口径

现在故意按「整场会话记在 lastActivity 小时」。若要按开始–结束均摊，先确认 ccusage 的 session JSON 有没有开始时间（目前适配器只读了 `metadata.lastActivity`），再改 `sessionsHourlyBuckets`，并改图下那句说明。不要假装已经是精确小时计量。

### 加皮肤

`src/shared/skins.ts` 的 `SKINS` 加一条，`skins.css` 里写 `[data-skin='id']` 覆写。图表色走 `series` 调色板。

### 可以直接贴给 AI 的开头

```
我在 Windows 上开发开源项目 coding-usage-dashboard（Electron + Vue 3 + TypeScript）。
先读 README.md 的「它是怎么做的」「已知问题与局限」「拿这份代码继续让 AI 开发」，
以及 src/shared/usage-model.ts 和 src/main/usage/service.ts。

目标：<一句话，例如「新增 Cursor 用量适配器」或「给 Claude 订阅加额度卡片」>

约束：fail-soft、token 不出主进程、renderer 只依赖 shared、不要把 Windows-only 的 API 改坏。
对照 src/main/zcode/ 或 src/main/quota/grok.ts 的现有写法。先列要改的文件再动代码。
```

更细的目录约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 从源码运行

需要 **Windows 10/11**、**Node.js 20+**。

```powershell
git clone https://github.com/funzza/coding-usage-dashboard.git
cd coding-usage-dashboard
npm install
npm run dev        # 开发模式（HMR）
npm test           # 本机没有对应数据源的集成测试会自动跳过
npm run typecheck
npm run build      # 编译到 out/
npm run dist       # NSIS 安装包到 dist/（不发布到 GitHub）
```

技术栈：Electron · Vue 3 · TypeScript · electron-vite · ECharts · Pinia

## 隐私

- 只读本机（及 WSL 文件系统）已有数据，不上传
- 无账号系统、无遥测、无分析 SDK
- 手动添加的额度 token 经 DPAPI 加密；日志与错误信息脱敏

## 许可证

[MIT](LICENSE)

与 Anthropic、OpenAI、xAI、Moonshot、OpenCode 等均无官方关系。第三方桌面客户端，读取的是本机 CLI / 本地数据库。
