# Kimi Quota 调研

> 调研日期:2026-08-21。环境:Windows 11,kimi.exe 版本 2026-08-19 构建,region=cn,已登录 Kimi For Coding(会员档 Allegretto / LEVEL_INTERMEDIATE)。
> 所有 token/手机号均已脱敏。所有端点均为本机实测验证(GET 类只读请求,未发送任何模型推理请求)。

## 结论

**可行性:高(官方 API 可用 + 本地可读双通道)。推荐采集方式:通过 `kimi web` 本地服务的 `GET /api/v1/oauth/usage` 端点读取额度**(该端点已被官方文档收录,Bearer token 即本机 `~/.kimi-code/server.token`,且由 CLI 自动处理 access_token 刷新);备选方案为携带 CLI 凭据直接调用云端 `GET https://api.kimi.com/coding/v1/usages`(实测 200,但属未公开文档的内部端点,变动风险自担)。

## 额度体系

依据官方文档(membership.html、help/kimi-code/benefits)与本机 `/usages` 实测响应交叉验证:

| 层级 | 周期 | 说明 |
|---|---|---|
| Kimi 会员共享额度池 | 月度周期 | 按 token 用量计费;Kimi Code 与网页版 Kimi、Kimi Work 等共享;月度刷新、不结转。池耗尽会冻结 Kimi Code 额度。**本接口不直接暴露池内剩余 token 数**(月度消耗在 kimi.com 订阅页查看) |
| Kimi Code 周额度 | 每 7 天 | 以订阅日为起点滚动刷新(D1–D7、D8–D14…),未用完不累积。实测:`summary.window={duration:1,unit:"week"}`, used=15/100, reset_at=`2026-08-28T01:22:43Z`(恰为窗口起点+7天) |
| Kimi Code 5 小时限流 | 5 小时滚动窗口 | 短时间请求过多触发限流,窗口滚动后自动恢复。实测:`limits[0].window={duration:300,timeUnit:"TIME_UNIT_MINUTE"}`, used=3/100, reset_at=`2026-08-21T11:22:43Z` |
| 并发限制 | 实时 | 实测 `parallel.limit=20`;官方帮助文档称最高 30 路(视套餐) |
| 加油包 Extra Usage | 余额制 | RMB 计价、不过期、可叠加,网页版与 Kimi Code 共享;可设每月消费上限。本账户未开启(API 返回 `extra_usage:null`) |

- **单位**:API 中 used/limit/remaining 为无量纲整数。官方错误参考将 5 小时窗口描述为"调用量"(请求数);会员共享池按 token 计费但不在本接口体现。100 的确切单位官方未明示,**存在语义不确定性**。
- **用户可见界面**:① CLI 交互会话内 `/usage` 斜杠命令;② Kimi Code 控制台 https://www.kimi.com/code/console (剩余额度+频限状态);③ kimi.com → 设置 → 订阅和发票 → 我的额度(`https://www.kimi.com/membership/subscription?tab=quota`)。

## 方式 A:本地数据

### A1. 静态文件 —— 无额度数据

| 路径 | 内容 | 结论 |
|---|---|---|
| `C:\Users\funzza\.kimi-code\credentials\kimi-code.json` | OAuth 凭据 | 只有 token,无额度。字段:`access_token`(JWT,~696B)、`refresh_token`、`expires_at`(epoch 秒)、`expires_in=900`、`scope="kimi-code"`、`token_type="Bearer"` |
| `C:\Users\funzza\.kimi-code\server.token` | 本地服务 Bearer token | 持久不变(43 字符,示例 `fP16...`),用于鉴权本地 REST API |
| `C:\Users\funzza\.kimi-code\region` | `cn` | 决定接入区域 |
| `~/.kimi-code/logs\`、`cache\`、`user-history\`、AppData(kimi-desktop) | 日志/缓存 | 无额度信息(AppData 仅 Electron 浏览器缓存) |

### A2. CLI 命令 —— 无独立 quota 子命令

`kimi --help` 全部子命令:`export / provider / acp / web / server / login / doctor / vis / migrate / upgrade`。无 `quota/status/usage` 子命令。`/usage` 是 TUI 内斜杠命令(需交互会话),不适合程序化采集。

### A3. `kimi web` 本地服务 REST API(推荐,官方文档化)

- 启动:`& "C:\Users\funzza\.kimi-code\bin\kimi.exe" web --no-open --port 58631`(默认端口 58627,被占自动 +1)
- 文档:https://www.kimi.com/code/docs/kimi-code-cli/reference/server-api.html 「登录与用量」节,明确列出 `GET /api/v1/oauth/usage` = "查询套餐用量与限额"。注意官方标注整组 API 为**实验性**,字段可能随版本变化
- 鉴权:`Authorization: Bearer <server.token>`(token 来自 `~/.kimi-code/server.token`)
- **更新时机**:实时查询云端(服务端内部调 `GET {base}/usages`);查询时若 access_token 过期会自动用 refresh_token 刷新并回写 credentials 文件(实测 14:24:22 发生回写)

实测请求/响应(2026-08-21):

```
GET http://127.0.0.1:58631/api/v1/oauth/usage?provider=managed:kimi-code
Authorization: Bearer fP16...
```

```json
{
  "code": 0, "msg": "success",
  "data": {
    "kind": "ok",
    "summary": { "window": {"duration": 1, "unit": "week"}, "used": 15, "limit": 100, "reset_at": "2026-08-28T01:22:43Z" },
    "limits": [ { "window": {"duration": 5, "unit": "hour"}, "used": 3, "limit": 100, "reset_at": "2026-08-21T11:22:43Z" } ],
    "extra_usage": null
  },
  "request_id": "01M0HG2MHYQAFYH3S5F70XC9KM"
}
```

另有 `GET /api/v1/oauth/userinfo?provider=managed:kimi-code` 返回账号资料(userId、nickname、userLevelName="Allegretto"、region 等,已脱敏)。探活免鉴权:`GET /api/v1/healthz`。

覆盖度:周额度 ✅ / 5 小时限流 ✅ / 重置时间 ✅ / 加油包余额与月消费上限 ✅(开启后返回)/ 会员共享池月度余量 ❌(需网页订阅页)。

## 方式 B:官方 API

### B1. 云端用量端点(实测可用,未公开文档)

```
GET https://api.kimi.com/coding/v1/usages
Authorization: Bearer <access_token>
```

- base URL 来自二进制常量 `DEFAULT_KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1"`(可被环境变量 `KIMI_CODE_BASE_URL` 覆盖);账号资料在同源 `GET /coding/v1/me`
- 认证来源:`~/.kimi-code/credentials/kimi-code.json` 的 `access_token`(**15 分钟时效**,过期后需用 `refresh_token` 向 `https://auth.kimi.com/v1/oauth/token` 刷新——CLI 自己就是这么做的)

curl 示例:

```bash
curl -s -H "Authorization: Bearer <access_token>" \
  https://api.kimi.com/coding/v1/usages
```

真实响应(HTTP 200,2026-08-21 实测,userId 已脱敏):

```json
{
  "user": { "userId": "d8uu...", "region": "REGION_CN", "membership": {"level": "LEVEL_INTERMEDIATE"}, "businessId": "" },
  "usage":   { "limit": "100", "used": "15", "remaining": "85", "resetTime": "2026-08-28T01:22:43Z" },
  "limits": [ { "window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
                "detail": { "limit": "100", "used": "3", "remaining": "97", "resetTime": "2026-08-21T11:22:43Z" } } ],
  "parallel": { "limit": "20" },
  "totalQuota": {},
  "authentication": { "method": "METHOD_ACCESS_TOKEN", "scope": "FEATURE_CODING" },
  "subType": "TYPE_PURCHASE",
  "domain": "DOMAIN_NEXUS"
}
```

注意:数值是**字符串**类型;`remaining` 字段本地服务代理层不透传(其自行换算);`totalQuota` 当前为空对象,推测会员共享池信息非默认返回。

### B2. Token 刷新(了解即可,不建议自行实现)

刷新端点 `https://auth.kimi.com/v1/oauth/token`(二进制常量 `TOKEN_ENDPOINT`),标准 OAuth2 refresh_token grant。**自行刷新有风险**:若服务端做 refresh token rotation,外部刷新会使 CLI 存储的 refresh_token 失效,导致用户被登出。

### 频率限制

- 云端 `/usages` 响应头无任何 `X-RateLimit-*` / `Retry-After` 字段(Server: nginx,仅 X-Trace-Id 等);未观测到限流阈值,建议轮询间隔 ≥30s 保持保守
- 本地服务自身对鉴权失败有封禁机制(60 秒内失败 10 次 → 429 封禁 60 秒),正常使用不会触发

## 风险与限制

1. **云端 `/usages` 无公开契约**:从 CLI 二进制逆向 + 实测确认,官方未承诺稳定性,路径/字段可能随版本变动(如 `TIME_UNIT_*` 枚举、字符串数值)。
2. **本地 REST API 标注"实验性"**:虽已进官方文档,但文档明示"端点、字段与事件类型可能随版本随时更改",集成时应以运行版本服务的 `/openapi.json` 为准(需鉴权获取)。
3. **access_token 15 分钟短时效**:直连云端必须处理刷新;与正在运行的 CLI/TUI 并发刷新可能产生 rotation 冲突。走 `kimi web` 代理可完全规避此问题。
4. **单位语义不确定**:used/limit=15/100 的"100"是请求数还是其他 credit 单位,官方未明示;不同套餐档位数值不同(帮助文档称 5 小时窗口约 300–1200 次请求)。
5. **会员共享池月度余量不可得**:两个通道都只反映 Kimi Code 的周/5小时窗口与加油包,月度 token 池余量仅在 kimi.com 网页订阅页展示(无已知 API)。
6. **ToS**:读取自己账户的用量属低敏感操作,但调用未公开端点不在官方支持范围;应避免高频轮询给服务端造成压力。
7. **多实例并存**:同一 home 目录可跑多个 `kimi web` 实例(登记于 `~/.kimi-code/server/instances/`),采集端应先探测已有实例再决定是否拉起 sidecar。

## 建议

1. **首选链路**:探测 `127.0.0.1:58627..58727` 已有 `kimi web` 实例(`GET /api/v1/healthz` 免鉴权)→ 有则直接带 server.token 调 `GET /api/v1/oauth/usage`;无则由 Electron 应用以 `--no-open` 拉起 sidecar 再查询。优点:官方文档化、自动处理 token 刷新、零凭据管理。
2. **UI 字段映射**:`summary` → 周额度进度条(used/limit/reset_at 倒计时);`limits[]` 中 5 小时窗口 → 限流提示;`extra_usage.balanceCents/monthlyUsedCents/monthlyChargeLimitCents` → 加油包卡片;`null` summary → 未登录或免费户提示升级。
3. **降级策略**:本地服务不可达时,可读 `credentials/kimi-code.json` 直连云端 `/usages`,但须校验 `expires_at` 且**不要自行刷新 refresh_token**,过期则显示"请打开 Kimi Code 以刷新"。
4. **轮询**:30–60 秒一次足够;重置时间(reset_at/resetTime)为 ISO8601 UTC,可直接做本地倒计时。
5. **健壮性**:解析按"字段可能缺失"设计(CLI 自身解析器即如此:任何字段缺失都降级为 null/空数组);数值同时兼容 string 与 number。
