# OpenCode Go Quota 调研

> 调研日期:2026-08-21 · 环境:Windows 11 + opencode CLI 1.18.15(已登录 OpenCode Go 订阅)
> 所有结论均来自本机实测(只读操作)与官方文档/源码证据;凭据已脱敏(保留前 4 位)。

## 结论

**可行性评级:官方 API 可用(推荐)。** `GET https://opencode.ai/zen/go/v1/usage` 携带 `Authorization: Bearer <API key>` 即可返回 rolling / weekly / monthly 三个窗口的已用百分比与重置时间,实测 200 OK。key 直接读本地 `%USERPROFILE%\.local\share\opencode\auth.json` 的 `opencode-go.key` 字段,无需抓网页、无需 workspace id / cookie。本地数据(opencode.db / 日志)**不含**订阅额度,只能做 ccusage 式 token 统计的补充。

## 额度体系

来源:官方文档 https://opencode.ai/docs/go/(2026-08-20 更新版)+ 本机实测。

| 项目 | 内容 |
|---|---|
| 订阅价格 | $5 首月,之后 $10/月 |
| 额度单位 | **美元金额**(非请求数、非 token)。实际请求数取决于所用模型单价 |
| Rolling 窗口 | 5 小时滑动窗口,上限 **$12** 用量 |
| Weekly 窗口 | 上限 **$30**,每周一 00:00 UTC 重置(实测 resetsAt=2026-08-24T00:00:00Z,恰为周一) |
| Monthly 窗口 | 上限 **$60**,按订阅计费周年日重置(实测 resetsAt=2026-09-06T03:43Z,与订阅日起算一个月吻合) |
| 超限行为 | 聊天请求报错,响应体含 `GoUsageLimitError`,带 `metadata.limitName`(限额名)、`metadata.workspace`,以及 `Retry-After` 头(距重置秒数);CLI TUI 据此弹 "Go limit reached" 提示 |
| 超限兜底 | 若 Zen 账户有余额并在 console 开启 "Use balance",超限后自动回落到按量扣余额 |
| 官方调整风险 | 文档明示 "Usage limits may change as we learn from early usage and feedback" |

用户查看额度的位置:
- 网页 console:`https://opencode.ai/workspace/<workspaceId>/go`(CLI 内部跳转链接即此地址);
- CLI/TUI:**无任何额度查询命令或常驻显示**(见方式 A),仅超限时弹错误提示。

## 方式 A:本地数据

结论:**没有任何本地文件包含订阅额度/百分比数据**,只有会话级 token 统计与凭据。

### A1. auth.json —— 有效凭据(采集 API 必需)

- 路径:`C:\Users\funzza\.local\share\opencode\auth.json`
- 格式:JSON。真实结构(脱敏):
  ```json
  {
    "opencode-go": { "type": "api", "key": "sk-R...(共67字符,已脱敏)" }
  }
  ```
- 含义:`opencode-go` 是 provider ID;`type:"api"` 表示 Bearer API key;该 key 即订阅鉴权凭据,**实测可调用 /usage(200)**。
- 更新时机:仅在 `opencode providers login`(/connect)登录/换绑时写入(本机为 2026-08-07),日常使用不变化。
- 注意:若设置了环境变量 `XDG_DATA_HOME`,数据目录会随之改变;Electron 读取时应先取 `%USERPROFILE%\.local\share\opencode\auth.json`,异常时再考虑 XDG 覆盖。

### A2. account.json —— 另有一份 opencode-go key,但无订阅权限

- 路径:`C:\Users\funzza\.local\share\opencode\account.json`
- 结构:`accounts{ <id>: { serviceID, credential:{type:"api", key} } } + active 映射`;其中 `serviceID:"opencode-go"` 条目的 key 为 `sk-m9...(已脱敏)`。
- **实测:用该 key 调 /usage 返回 `HTTP 403 {"type":"error","error":{"type":"EntitlementError","message":"OpenCode Go subscription required."}}`**。即此 key 未绑定订阅,不可用于查额度。集成时必须用 auth.json 的 key,不要用 account.json 的。

### A3. opencode.db(SQLite)—— 仅会话级 token/cost 统计

- 路径:`C:\Users\funzza\.local\share\opencode\opencode.db`(约 187MB,WAL 模式;查询务必先复制副本再开,避免锁库)
- 表:`message / part / session / event / account / account_state / control_account / credential ...`
- `message.data`(assistant 消息)示例(脱敏截选):
  ```json
  {"role":"assistant","cost":0,
   "tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},
   "modelID":"x-preview-f-free","providerID":"opencode","time":{"created":1787294115592}}
  ```
- 字段含义:`tokens`=该条消息 token 用量(ccusage 同源数据);`cost`=按价目表折算金额,**订阅模型下恒为 0**,因此无法从本地推算"已消耗 $12/$30/$60 中的多少"。
- `account / account_state / control_account` 表在本机均为空(此版本账户信息存文件而非库),无额度字段。
- 更新时机:每条消息实时写库。

### A4. 其他本地位置

- `log\opencode.log`:仅有 `Rate limit exceeded` 之类错误文本,无额度数值、无 usage 接口调用记录。
- `storage\`:仅 session_diff 快照,无关。
- CLI 命令排查:`opencode --help` 全量命令中无 usage/quota/status 类命令;`opencode stats` 只统计本地 db 的 token/成本;`opencode providers list` 只列凭据;`opencode debug config` 只回显配置。**CLI 无查询订阅额度的途径。**

覆盖度小结:方式 A 可拿到"用了多少 token"(ccusage 已做),拿不到"订阅周期用了百分之几/何时重置"。

## 方式 B:官方 API

### 端点(实测有效)

```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <auth.json 中 opencode-go.key>
```

### 真实响应(脱敏,2026-08-21 06:45 UTC 实测)

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 0, "resetsAt": "2026-08-21T10:51:22.725Z" },
    "weekly":  { "status": "ok", "percent": 20, "resetsAt": "2026-08-24T00:00:00.725Z" },
    "monthly": { "status": "ok", "percent": 37, "resetsAt": "2026-09-06T03:43:27.725Z" }
  }
}
```

字段含义:
- `rolling / weekly / monthly`:三个限额窗口(对应 $12 / $30 / $60);
- `percent`:该窗口已用百分比(整数);
- `resetsAt`:ISO8601 重置时间。rolling 的毫秒部分每次调用略有浮动(服务端即时计算),按近似值处理;
- `status`:实测仅见到 `"ok"`;超限时的取值未验证(无法在不消耗额度的前提下触发),推测为受限状态值,建议代码对未知值容错。

### 错误响应(实测)

| 场景 | 状态码 | 响应体 |
|---|---|---|
| 不带 Authorization | 401 | `{"type":"error","error":{"type":"AuthError","message":"Missing API key."}}` |
| key 错误 | 401 | `{"type":"error","error":{"type":"AuthError","message":"Unauthorized"}}` |
| key 有效但未订阅 Go | 403 | `{"type":"error","error":{"type":"EntitlementError","message":"OpenCode Go subscription required."}}` |

### curl 示例(key 从 auth.json 读入变量,不落日志)

```powershell
$key = (Get-Content "$env:USERPROFILE\.local\share\opencode\auth.json" -Raw | ConvertFrom-Json).'opencode-go'.key
curl.exe -s -H "Authorization: Bearer $key" https://opencode.ai/zen/go/v1/usage
```

### 频率限制与其他端点

- 响应头**无** `X-RateLimit-*` / `Retry-After` 等限流头;连续 3 次 GET 均 200,延迟约 1.2–2.4s。未见明确频率上限,但建议客户端缓存 ≥60s(社区插件普遍缓存 5 分钟)。
- `GET https://opencode.ai/zen/go/v1/models`:200,返回可用模型列表(同 Bearer 认证)。
- 以下路径实测均 404(SPA 兜底页):`/zen/v1/usage`、`/zen/go/v1/balance`、`/zen/go/v1/quota`、`/zen/go/v1/credits`、`/zen/go/v1/me`、`/zen/go/v1/limits`、`/zen/go/v1/rate_limits`。
- **主机名陷阱**:必须用 `https://opencode.ai`;`https://api.opencode.ai/zen/go/v1/*` 会返回 HTTP 200 + 纯文本 "Not Found" 的兜底响应(Cloudflare catch-all),不会报 4xx,解析时注意区分。

### 端点背景(公开性佐证)

- 该端点**未写入官方文档**(docs 只描述限额规则,不含此 API);它是应社区需求新增的:GitHub issue anomalyco/opencode #16017(2026-03)请求此功能时评论者实测尚不存在,后续 cc-switch issue #6433 与本次实测确认已上线并稳定运行。
- CLI 二进制内嵌字符串证实 Go 网关 base URL 为 `https://opencode.ai/zen/go/v1`(models.dev 目录亦含 `api:"https://opencode.ai/zen/go/v1"` 定义),与实测一致。

## 风险与限制

1. **接口公开性/变动风险(主要风险)**:`/zen/go/v1/usage` 目前无官方文档承诺,属于"事实存在"的接口,理论上可能变更路径或响应结构。缓解:解析时对字段缺失/结构变化容错,失败时降级展示。
2. **只有百分比,没有绝对金额**:API 只给 `percent`,不给"已用 $x / 上限 $y"。若要显示美元,只能叠加文档静态上限($12/$30/$60),而文档明示限额可能调整 → 建议以百分比为主展示,美元为辅(标注估算)。
3. **超限态 `status` 取值未验证**:不便主动触发(会消耗额度);需对非 `"ok"` 值做通用处理(视为受限,直接展示 percent≈100 与 resetsAt)。
4. **ToS 合规性**:用自己的 key GET 自己账户的用量属正常客户端行为,与 CLI 自身访问同一网关,低频轮询无滥用迹象;但应避免高频轮询(建议 ≥60s 间隔、界面隐藏时暂停)。
5. **凭据安全**:key 明文存于 auth.json,Electron 读取后须保存在主进程内存/安全存储,严禁写入日志或渲染进程;报告与日志一律脱敏。
6. **多账户/多 key 边界**:account.json 里同名服务的 key 可能无订阅权限(本机实测 403),务必以 auth.json 为准。

## 建议

1. **采集方式:方式 B(官方 API)为主**——按需或定时(≥60s 缓存)GET `/zen/go/v1/usage`,Bearer key 读自 `%USERPROFILE%\.local\share\opencode\auth.json` 的 `opencode-go.key`。
2. UI 展示三行进度条:5h / 周 / 月,`percent` + `resetsAt` 倒计时;`status !== "ok"` 或请求 403 时降级为"未订阅/受限"提示。
3. **方式 A 作辅助**:继续用 opencode.db(`message.data.tokens`)做 ccusage 式 token 明细;不要试图从本地推算订阅百分比(订阅消息 cost=0,推不出来)。
4. 健壮性:主机固定 `opencode.ai`(警惕 api.opencode.ai 的 200 "Not Found" 兜底);对 401/403/5xx/结构变更分别降级;预留"端点失效→仅展示本地 token 统计"的开关。
5. 可参考的现成实现:cc-switch issue #6433 内附同端点的解析脚本;ridho9/opencode-go-usage(旧方案,cookie+workspaceId 抓网页,已被本 API 取代,不建议效仿)。
