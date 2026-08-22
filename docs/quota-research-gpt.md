# GPT(Codex)Quota 调研

> 调研日期:2026-08-21 | 环境:Windows 11,ChatGPT Plus 账号(已登录 Codex CLI 0.130.0 + Codex 桌面端残留)
> 方法:本地文件只读检查 + 真实 HTTPS GET 实测 + 社区资料交叉验证。所有 token/account_id/email 均已脱敏(保留前 4 位)。

## 结论

**可行性评级:官方 API 可用(最高级)。** 推荐采集方式:**主采集 = `GET https://chatgpt.com/backend-api/wham/usage`(用 `~/.codex/auth.json` 的 ChatGPT access_token,60 秒轮询)**,已实测 HTTP 200 返回完整额度;**兜底/历史 = 本地 sessions JSONL 里每轮响应自带的 `rate_limits` 快照**;`codex app-server` RPC(`account/rateLimits/read`)亦实测可用,作为免管 token 的备选。

## 额度体系

| 项目 | 实测/文档结论 |
|---|---|
| 周期 | 双滚动窗口同时生效:**5 小时**(300 min / 18000 s)+ **周**(10080 min / 604800 s),任一达 100% 即限流 |
| ⚠️ 窗口动态开关 | **本机 Plus 账号实测当前只有周窗口在计**(`primary_window.limit_window_seconds=604800`,`secondary_window=null`)。社区实现(llmtrim quota.rs、oc-codex-multi-auth)同样记录:"Plus often weekly-only;Pro-style plans add a ~5h primary"。旧会话(2026-07-09)里同一账号则是 primary=5h+secondary=周。**UI 必须按 `limit_window_seconds` 动态渲染窗口标签,不能硬编码"5h/周"** |
| 单位 | `used_percent`:整数百分比 0–100(**无绝对量**,不暴露消息数/token 数);`credits.balance`:美元余额字符串(如 `"178.7548895000"`);新版还有 `approx_local_messages` / `approx_cloud_messages` 剩余消息数区间估计 |
| 重置规则 | 滚动窗口,非固定周期。字段:`reset_at`(unix 秒)或 `reset_after_seconds`(相对秒),两者至少有一个 |
| 用户可见处 | Codex TUI 内 `/status`(显示 "5h limit"/"Weekly limit"/"Credits" 行)、Codex Desktop Settings→Account、chatgpt.com 的 Codex 页面 |

## 方式 A:本地数据

### A1. sessions JSONL —— 每轮响应自带 rate_limits 快照(推荐做兜底/历史)

- **路径模式**:`C:\Users\funzza\.codex\sessions\YYYY\MM\DD\rollout-<时间戳>-<uuid>.jsonl`(`archived_sessions\` 下同构)
- **格式**:JSONL,每行一个事件;额度在 `type=event_msg`、`payload.type=token_count` 事件的 `payload.rate_limits` 里
- **更新时机**:每次模型响应后随 token_count 事件落盘(即每轮 turn 至少一条);只有跑过 Codex 会话才有新数据 → **被动数据源**
- **覆盖度**:每次请求的用量百分比 + credits + plan_type;无绝对量

新格式实测样例(2026-08-21,桌面端写入,primary=周窗口):

```json
{"timestamp":"2026-08-21T04:23:30.214Z","type":"event_msg","payload":{"type":"token_count",
 "info":{"total_token_usage":{"input_tokens":18508,"cached_input_tokens":9984,"cache_write_input_tokens":0,"output_tokens":247,"reasoning_output_tokens":92,"total_tokens":18755},
         "last_token_usage":{...},"model_context_window":258400},
 "rate_limits":{"limit_id":"codex","limit_name":null,
   "primary":{"used_percent":26.0,"window_minutes":10080,"resets_at":1787804314},
   "secondary":null,
   "credits":{"has_credits":true,"unlimited":false,"balance":"178.7548895000"},
   "individual_limit":null,"spend_control_reached":null,
   "plan_type":"plus","rate_limit_reached_type":null}}}
```

旧格式实测样例(2026-07-09,CLI 0.130 写入,双窗口 snake_case 同名但位置不同):

```json
"rate_limits":{"limit_id":"codex","limit_name":null,
 "primary":{"used_percent":41.0,"window_minutes":300,"resets_at":1783575368},
 "secondary":{"used_percent":40.0,"window_minutes":10080,"resets_at":1783993448},
 "credits":{"has_credits":false,"unlimited":false,"balance":null},
 "individual_limit":null,"plan_type":null,"rate_limit_reached_type":null}
```

字段含义:`used_percent`=该窗口已用百分比;`window_minutes`/`limit_window_seconds`=窗口长度(300≈5h,10080=7d);`resets_at`=重置时刻(unix 秒);`plan_type`=订阅档位(plus/pro/…,可能为 null);`rate_limit_reached_type`=限流类型;`credits.*`=付费 credit 余额。

### A2. `codex app-server` JSON-RPC —— CLI 自带查询通道(实测成功)

- 启动:`codex -s read-only -a untrusted app-server`(stdin/stdout,JSONL 帧 JSON-RPC)
- 握手序列:`initialize` → 收到 result 后发 `initialized` 通知 → `account/rateLimits/read`
- 实测真实响应(2026-08-21,codex 0.130.0,注意是 camelCase):

```json
{"id":2,"result":{"rateLimits":{"limitId":"codex","limitName":null,
  "primary":{"usedPercent":31,"windowDurationMins":10080,"resetsAt":1787804314},
  "secondary":null,
  "credits":{"hasCredits":true,"unlimited":false,"balance":"178.7548895000"},
  "planType":"plus","rateLimitReachedType":null},
 "rateLimitsByLimitId":{"codex":{...同上,按 limit_id 分组,可含模型级限额...}}}}
```

- 优点:token 由 CLI 自己读取和刷新,集成方不碰凭据;缺点:需管理子进程生命周期与超时;**版本 schema 漂移明显**(0.130 与桌面版字段命名不同);本机实测发现 CLI 启动时会向临时 CODEX_HOME 克隆插件市场(有网络副作用);且本机 Volta 版 codex 0.130 解析桌面端写的 `config.toml` 直接报错(`agents.default_subagent_model` 类型不兼容)——走此路线必须处理版本匹配
- 另:`codex login status` 只输出登录态("Logged in using ChatGPT"),**不含额度**;TUI `/status` 有人读的额度文本但无法安全地非交互捕获

### A3. 已排除的数据源(实测无额度数据)

| 数据源 | 结论 |
|---|---|
| `~/.codex/state_5.sqlite`、`sqlite\state_5.sqlite`、`sqlite\codex-dev.db`、`sqlite\logs_2.sqlite` | 无任何 rate/limit/usage 相关表或列;`thread_timeline_ledger.payload_json` 与 `logs.feedback_log_body` 全文 LIKE '%rate_limit%' 均 0 命中 |
| `~/.codex/log\`、`AppData\Local\Codex\Logs\` | 空 |
| `session_index.jsonl` | 仅 `{id, thread_name, updated_at}`,无额度 |
| `auth.json` | 不是额度数据,但是 API 认证来源(见方式 B) |

### auth.json 结构(脱敏)

```
auth_mode = "chatgpt"(len=7)
OPENAI_API_KEY = null(len=4)
tokens.id_token      = eyJh...(JWT, len=1920)
tokens.access_token  = eyJh...(JWT, len=1884)   ← 方式 B 用它
tokens.refresh_token = rt.1...(len=211)
tokens.account_id    = bd6b...(UUID, len=36)   ← ChatGPT-Account-Id 头
last_refresh = 2026-08-21 ...
```

access_token JWT payload 实测:`iss=https://auth.openai.com`,`aud=https://api.openai.com/v1`,签发 2026-08-21 04:32 UTC,**exp 2026-08-31(10 天有效期)**。CLI 会用 refresh_token 自动刷新并重写 auth.json(更新 `last_refresh`)。

## 方式 B:官方 API(推荐主采集,已实测)

- **URL**:`GET https://chatgpt.com/backend-api/wham/usage`
- **认证来源**:`~/.codex/auth.json` → `tokens.access_token`(Bearer)+ `tokens.account_id`(`ChatGPT-Account-Id` 头,**实测可选**:不带该头仍返回 200,仅 `account_id` 字段为空)
- **curl 示例**:

```bash
TOKEN=$(jq -r .tokens.access_token ~/.codex/auth.json)
ACCT=$(jq -r .tokens.account_id  ~/.codex/auth.json)
curl -s https://chatgpt.com/backend-api/wham/usage \
  -H "Authorization: Bearer $TOKEN" \
  -H "ChatGPT-Account-Id: $ACCT" \
  -H "Accept: application/json"
```

- **真实响应(2026-08-21 实测 HTTP 200,已脱敏)**:

```json
{
  "user_id": "user...",
  "account_id": "bd6b...",
  "email": "***@***",
  "plan_type": "plus",
  "rate_limit": {
    "allowed": true,
    "limit_reached": false,
    "primary_window": {
      "used_percent": 30,
      "limit_window_seconds": 604800,
      "reset_after_seconds": 509076,
      "reset_at": 1787804314
    },
    "secondary_window": null
  },
  "code_review_rate_limit": null,
  "additional_rate_limits": null,
  "credits": {
    "has_credits": true, "unlimited": false, "overage_limit_reached": false,
    "balance": "178.7548895000",
    "approx_local_messages": [45, 232],
    "approx_cloud_messages": [7, 45]
  },
  "spend_control": { "reached": false, "individual_limit": null },
  "rate_limit_reached_type": null,
  "promo": null,
  "rate_limit_reset_credits": { "available_count": 0, "applicable_available_count": 0 }
}
```

- **旧端点已死**:`GET /backend-api/codex/usage` 实测 403(Cloudflare HTML 拦截页)。更早还有 `x-codex-*-*` 响应头方案,现行传输层已不再返回(headroom 项目记录)
- **频率限制**:官方 CLI 自己就是 **~60 秒轮询一次** 该端点(openai/codex#10869 中源码级确认:`ChatWidget::prefetch_rate_limits` 起 60s interval poller);社区工具统一取 ≥60s;过密轮询会吃 **429**(usageowl 报告 OAuth usage 端点在反复刷新下回 429)。错误语义:401→token 失效需重新登录,403+HTML→Cloudflare 拦截,429→退避
- **数据新鲜度**:端点是懒更新——通常在下一次计费请求或跨过 `reset_at` 时才变化(codex-lb 项目观察);重置后短时间内可能仍返回旧值,UI 需容忍

## 风险与限制

1. **接口未公开文档化,有变动史**:`x-codex-*` 响应头 → `/backend-api/codex/usage` → `/backend-api/wham/usage`,可能再变。需做好 schema 宽松解析 + 失败静默降级。
2. **Cloudflare**:异常 UA/指纹可能被拦(403 HTML)。实测带 `User-Agent: codex_cli_rs` 或普通 UA 均通过;建议 UA 模拟官方 CLI。
3. **凭据管理**:access_token 10 天过期,由 CLI 自动刷新。集成侧**不要自己实现 refresh 流程**(涉及 client_id/密钥,风险高),每次请求前重读 auth.json 即可;401 时提示用户跑一次任意 codex 命令即可续期。
4. **ToS**:灰色地带但低风险——用自己的凭据读自己账户的用量,与官方 CLI 行为一致(CodexBar、usageowl、headroom、CodeyBox 等众多开源工具同此运作);不得用于爬取他人数据或高频打接口。
5. **粒度限制**:只有整数百分比,无绝对量;token 维度仍需 ccusage 补足,两者互补(ccusage=用了多少 token,本端点=还剩多少额度)。
6. **schema 漂移**:sessions JSONL 新旧格式字段命名不同(snake_case 一致但窗口角色互换);app-server RPC 是 camelCase 且随版本变。
7. **本机特有坑**:Volta 的 npm codex 0.130 无法解析桌面端写的 config.toml(schema 冲突),若走 app-server 路线需先解决版本匹配。

## 建议

1. **主采集**:Electron 主进程每 **60s** `GET /wham/usage`;每次请求前从 auth.json 现读 token(文件 IO 开销可忽略);401→UI 提示"请打开一次 Codex 以刷新登录";429/403→指数退避并保留上次快照。
2. **辅助采集**:tail 监听 `~/.codex/sessions/**/**/**/*.jsonl` 的 `token_count.rate_limits`,获得零成本实时更新与离线历史曲线(与 ccusage 读本地文件的思路一致)。
3. **UI 渲染规则**:窗口标签按 `limit_window_seconds` 动态映射(18000→"5 小时",604800→"每周",其他→"N 天");`secondary_window=null` 时隐藏该卡片;"剩余" = 100 − used_percent;重置时间优先 `reset_at`,缺失则 now + `reset_after_seconds`。
4. **可选展示**:`plan_type` 徽标、`credits.balance`(美元)、`approx_local_messages` 区间、`additional_rate_limits[]`(模型级限额,Pro/特殊模型场景出现)。
5. **不做**:自行实现 OAuth refresh、低于 60s 的轮询、解析 TUI `/status` 文本(脆弱)。
