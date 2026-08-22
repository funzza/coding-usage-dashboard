# 阿里 Token Plus Quota 调研

> 调研日期:2026-08-21 · 环境:Windows 11 · 全程只读,未发送任何模型推理请求
> 所有密钥均已脱敏(保留前 4~5 位 + `***`)

## 结论

**可行性评级:部分可行(本地可读 + 被动信号;无官方公开额度 API)。**
推荐采集方式:**本地聚合用量(opencode.db / Claude Code 会话记录)+ 被动解析 429 配额错误中的精确重置时间**;「剩余百分比」目前只能引导用户到百炼控制台查看,或等拿到有效 `sk-sp-` Key 后再实测网关隐藏端点。本机现存的阿里 Token Plan Key 已失效(401),无法完成带鉴权的端点验证。

## 额度体系

产品全称:**阿里云百炼 Token Plan**(本机对应 models.dev 注册的 provider `alibaba-token-plan-cn`,仅华北2·北京地域)。

| 项目 | 内容 |
|---|---|
| 计量单位 | **Credits**(非 token、非金额)。单次消耗由模型、token 量、思考模式、工具调用动态折算(官方示例:qwen3.6-plus 单请求 ≈3.18 Credits) |
| 个人版窗口 | **双重限额**:① 5 小时滚动窗口(Lite 700 / Standard 3000 / Pro 12000 Credits);② 7 天固定窗口(2500 / 10000 / 40000 Credits)。**自首次调用起计时,非自然月/自然周**,未用完不结转 |
| 团队版 | 月度总额度制(25k/100k/250k Credits/坐席/月),按订购日起算(订阅月,非自然月),无 5h/7d 窗口 |
| 政策波动 | 官方 FAQ(2026-08-13 更新):5 小时限额**当前限时取消**;但本机 2026-07-28 的真实 429 证明当时生效 |
| 触顶行为 | HTTP 429,`Allocated quota exceeded`。本机实测样本(Claude Code 会话记录):`API Error: Request rejected (429) · Your token-plan 5-hour quota has been exhausted. The quota will reset at 07-28 12:02:00 UTC.` |
| 手动重置 | 「重置卡」:一次性权益,控制台点「重置限额」立即重置 |
| 用户查看位置 | 百炼控制台「我的订阅」页:`https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan`(显示总额度使用百分比、重置时间);团队版另有「用量分析」页 |
| 接入凭证 | 专属 API Key 格式 `sk-sp-xxxxx`(与通用 `sk-` 不通用);专属 Base URL:OpenAI 兼容 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`,Anthropic 兼容 `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic` |

依据:help.aliyun.com《Token Plan 概述》《Token Plan 个人版常见问题》(2026-08-13/08-18 版)、alibabacloud.com《Token Plan (Team Edition) overview》、models.dev 注册表。

## 方式 A:本地数据

### A1. opencode 数据库(主要本地来源)

- **路径**:`C:\Users\funzza\.local\share\opencode\opencode.db`(SQLite,约 187 MB,另有 `-wal`/`-shm`;查询前应复制到临时目录只读打开)
- **格式**:SQLite。关键表:
  - `message`:每条消息一行,`data` JSON 内含 `providerID`、`modelID`、`tokens:{input,output,reasoning,cache:{read,write}}`、`time.created/completed`
  - `session`:会话级汇总(`tokens_input/output/reasoning/cache_read/cache_write`、`model`)
  - `part`:工具调用明细
- **示例**(脱敏,取自真实库):
  ```json
  {"providerID":"xiaomi-token-plan-cn","modelID":"mimo-v2.5-pro","cost":0,
   "tokens":{"total":163957,"input":508,"output":174,"reasoning":11,
             "cache":{"write":0,"read":163264}},
   "time":{"created":1780034955367,"completed":1780034963903}}
  ```
- **更新时机**:每条 assistant 消息完成即写入(近实时)
- **覆盖度**:只有 token/请求数,**没有 Credits 折算、没有总额度、没有剩余量**。注意:本机 DB 中历史 providerID 是 `xiaomi-token-plan-cn`(小米通道,mimo 模型);`alibaba-token-plan-cn` 在本机 DB 无历史记录,阿里通道的证据在 opencode.json 配置与 Claude Code 会话中
- ccusage 类工具可直接复用此数据源做"周期内已用"统计

### A2. Claude Code 会话 JSONL(含配额重置时间戳)

- **路径**:`C:\Users\funzza\.claude\projects\<项目目录编码>\<sessionId>.jsonl`(及 `subagents\*.jsonl`)
- **内容**:逐条消息含 model usage;**当配额触顶时,错误文本内嵌精确重置时间**,如上表所引 07-28 样本(来自 `D--hf-project-oa-backend\fc599b4a-....jsonl`)
- **更新时机**:实时追加
- **覆盖度**:429 重置时间是唯一能程序化拿到的"何时恢复"信号,但**只在额度耗尽时出现**

### A3. 凭据/配置文件(数据源元信息)

| 文件 | 内容 | 状态 |
|---|---|---|
| `C:\Users\funzza\.config\opencode\opencode.json` | provider `ali`:baseURL=`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`,apiKey=`sk-sp***`(113 字符,即官方 sk-sp 专属 Key 格式),模型 qwen3.8-max(-preview)、deepseek-v4-flash-0731 | Key 已失效(见方式 B);provider 在 `opencode.jsonc` 的 `disabled_providers` 中被禁用 |
| `C:\Users\funzza\.local\share\opencode\auth.json` | 仅 `opencode-go`(opencode zen 网关)`sk-R***`,与阿里无关 | — |
| `C:\Users\funzza\.local\share\opencode\account.json` | 多账户管理:`xiaomi-token-plan-cn`(tp- 开头 Key,已脱敏)、deepseek、openstarry 等;无 alibaba 条目 | 说明当前活跃订阅非阿里 |

### A4. 无本地额度缓存

网关不在本地落盘任何额度/Credits 数据;除上述外未发现其他相关数据源。

## 方式 B:官方 API

### B1. 网关本体(已实测)

- **baseURL**:`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`(认证来源:`opencode.json → provider.ali.options.apiKey`,脚本内存读取,未打印)
- **实测 1**——`GET {base}/models`,`Authorization: Bearer sk-sp***`:
  ```json
  HTTP 401
  {"request_id":"6924b13d-...","code":"InvalidApiKey","message":"Invalid API-key provided."}
  ```
  响应头 `Server: istio-envoy` + DashScope 风格错误体 → **确认为阿里云官方基础设施,非 one-api/new-api 类代理**
- **实测 2**——不带 Key:`401 {"code":"InvalidApiKey","message":"No API-key provided."}`
- **实测 3**——随机不存在路径 `/compatible-mode/v1/definitely-not-a-real-path-xyz`:同样返回鉴权 401 → **鉴权中间件前置,无效 Key 无法探测路由存在性**
- **实测 4**——`/v1/models`(根路径)、`/api/status`、`/api/user/self`、`/api/usage/token`:均 404(one-api 特征端点不存在)
- **Key 失效原因推断**:官方 FAQ 明确"重置 API Key 会使旧 Key 立即失效";该配置最后修改于 2026-08-20,且 provider 已被禁用 → 大概率 Key 已被重置或订阅停用

### B2. billing 类端点(one-api 风格)

`GET {base}/dashboard/billing/subscription`、`GET {base}/dashboard/billing/usage?start_date=...&end_date=...` 均返回与上面相同的鉴权 401,**无法确认路由是否存在**;官方文档从未提供面向 `sk-sp-` Key 的额度查询接口。curl 示例(供拿到有效 Key 后复测):

```bash
BASE=https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
KEY=sk-sp-xxxx   # 你的 Token Plan 专属 Key
curl -s -H "Authorization: Bearer $KEY" "$BASE/models"
curl -s -H "Authorization: Bearer $KEY" "$BASE/dashboard/billing/subscription"
curl -s -H "Authorization: Bearer $KEY" "$BASE/dashboard/billing/usage?start_date=2026-08-01&end_date=2026-08-22"
```

### B3. 控制台内部接口(未公开)

控制台「我的订阅」页数据走登录态下的内部接口(前端路由 `#/efm/subscription/token-plan` 暗示后端为 efm 服务)。RAM 系统策略 `AliyunTokenPlanReadOnlyAccess`(2026-06 发布,"只读管理百炼 TokenPlan")证明后端存在受 RAM 管控的 OpenAPI 形态接口,但**未检索到公开文档/公网端点**,调用需 AccessKey 签名(本机无 AccessKey,无法验证)。抓 Cookie 复用属网页抓取方案,脆弱且涉及登录态,不推荐。

### B4. 频率限制

官方未公开 TPM/RPM 数值("根据整体负载动态调整");429 本身即是额度信号。

## 风险与限制

1. **ToS 灰色地带**:Token Plan 条款限定"仅在兼容 AI 工具中交互式使用,不可用于自动化脚本或应用后端"。桌面应用做 GET 只读额度查询风险低,但高频轮询不被保护。
2. **接口未公开、随时变动**:额度查询无官方承诺;5h 限额本身处于"限时取消/恢复"波动中;Credits 折算系数不透明且分模型阶梯计费。
3. **Key 生命周期**:专属 Key 重置即失效(本机已发生一次),集成需处理 401 → 引导用户换 Key。
4. **口径差异**:官方 FAQ 明确"第三方工具统计的 Token 用量与百炼控制台不一致"(缓存命中、模型系数、功能模式影响),本地聚合只能做 token 级近似,无法精确等于 Credits。
5. **多订阅混淆**:本机同时存在阿里 Token Plan、小米 Token Plan(xiaomi-token-plan-cn,tp- Key)、opencode zen 等多条通道,采集时必须按 providerID/baseURL 区分。

## 建议

1. **主方案(立即可做)**:扩展 ccusage 式本地统计——读 `opencode.db` 的 `message.data.tokens`(按 `providerID in ('alibaba-token-plan-cn','ali')` 过滤)+ Claude Code JSONL,展示"当前 7 天窗口内已用 token/请求数"。窗口起点可取该 provider 首条消息时间 + 7 天滚动推算。
2. **额度信号(零成本高价值)**:拦截并解析推理响应的 429 错误体,提取 `The quota will reset at <time> UTC`,直接得到精确重置倒计时;平时置灰、触顶时展示。
3. **剩余百分比(短期)**:UI 上给出控制台「我的订阅」深链(`https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan`)让用户自查。
4. **后续验证(拿到有效 sk-sp Key 后)**:复测 B2 的 curl 组合确认网关是否在鉴权后暴露隐藏额度端点;同时关注阿里云是否开放 Token Plan OpenAPI(RAM 策略已就位,公开只是时间问题)。
5. **凭据安全**:读配置取 Key 时全程内存化、日志脱敏(本次调研已按此执行)。

---
*附:本次调研的探测脚本与 DB 副本位于 `Z:\Temp\opencode\quota-research\`(临时目录,可随时删除)。*
