# Grok Quota 调研

> 调研日期:2026-08-21(同日二次深挖,联网对照社区方案后**认证已破解**,端点实测 200)
> 环境:Windows 11,grok CLI 1.0.5 (5115b46bc9),SuperGrok 订阅。所有凭据已脱敏。

## 结论

**可行性评级:官方 API 可用(高)。** 推荐采集方式:**`GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`,只需两个请求头:`Authorization: Bearer <auth.json 的 key>` + `X-XAI-Token-Auth: xai-grok-cli`(固定字符串)**,实测 HTTP 200 返回完整额度(周窗口百分比、起止时间、产品维度用量、充值方式)。关键突破:grok CLI 官方开源在 `github.com/xai-org/grok-build`,`crates/codegen/xai-grok-shell/src/extensions/billing.rs` 即权威参考实现;此前直连 401 的原因是把 `X-XAI-Token-Auth` 当成 token 传(实际是路由标识常量)。本地日志(`~/.grok/logs/unified.jsonl`)降级为被动兜底方案。

## 额度体系

| 项 | 实测值 |
|---|---|
| 周期 | **7 天固定窗口**(订阅日起算),`currentPeriod.type = USAGE_PERIOD_TYPE_WEEKLY`;实测窗口 2026-08-15T19:39 → 2026-08-22T19:39(+08:00) |
| 单位 | **Credits 百分比**:`creditUsagePercent`(0–100,含小数);无绝对量。`Cent{val}` 字段为美分(proto3 JSON,0 值省略为 `{}`) |
| 产品维度 | `productUsage[]`:按产品拆分百分比,实测 `[{"product":"GrokBuild","usagePercent":100.0}]`(官方文档称周池跨 Chat/Imagine/Voice/API/Build 共享) |
| 重置规则 | 窗口结束自动重置;`currentPeriod.end` / `billingPeriodEnd` 即重置时间 |
| 账户形态 | `isUnifiedBillingUser=true`(统一账单);`topUpMethod=TOP_UP_METHOD_SAVED_PAYMENT_METHOD`;`onDemandCap/Used`、`prepaidBalance` 本账户均为 0 |
| 订阅层级 | `subscriptionTier="SuperGrok"`(**注意:该字段不来自 billing 端点**,CLI 从 RemoteSettings 拿,见下"已知差异") |
| 用户可见性 | grok.com Settings → Usage;CLI TUI 的 credits 显示;CLI 无独立 quota 子命令 |

## 方式 A:本地数据(降级为兜底)

### `C:\Users\funzza\.grok\logs\unified.jsonl`

- NDJSON;额度事件 `msg="billing: fetched credits config"`,会话期间每 ~30s 一条,**非会话期间不更新**(被动数据源)。
- 示例(脱敏):`ctx.config = {creditUsagePercent:55.0, currentPeriod:{type:"USAGE_PERIOD_TYPE_WEEKLY", start, end}, onDemandCap/Used, prepaidBalance, isUnifiedBillingUser, billingPeriodStart/End, historyLen}` + `ctx.subscriptionTier="SuperGrok"`。
- 日志里的 config 是 CLI 解析后的子集(丢弃了 `productUsage`、`topUpMethod`,history 只留长度+最新一条);**API 直连的数据比日志更全**。
- 用途:离线历史曲线、API 故障时的最近快照。

### 其他本地文件

- `~/.grok/auth.json`:键 `https://auth.x.ai::<oidc_client_id>`,值含 `key`(OIDC JWT,6h 时效,claims: iss=auth.x.ai、scope 含 `grok-cli:access api:access`、tier、team_id)、`refresh_token`、`user_id` 等。**这是 API 认证来源**;CLI 自动刷新回写。
- CLI `--help` 无任何 quota/usage/status 子命令;sessions/config.toml/models_cache.json 无额度数据。

## 方式 B:官方 API(推荐,已实测 200)

### 请求

```
GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
Authorization: Bearer <key>          # ~/.grok/auth.json → .key(JWT)
X-XAI-Token-Auth: xai-grok-cli       # 固定字符串!不是 token(nginx auth 子请求路由标识)
```

可选头(CLI 会带,实测不加也 200):`x-userid: <user_id>`、`x-grok-client-version: 1.0.5`、`x-grok-client-mode: cli`、`User-Agent: xai-grok-workspace/1.0.5`。

PowerShell 复现(key 内存读取,不落日志):

```powershell
$inner = (Get-Content "$env:USERPROFILE\.grok\auth.json" -Raw | ConvertFrom-Json).PSObject.Properties.Value[0]
curl.exe -s https://cli-chat-proxy.grok.com/v1/billing?format=credits `
  -H "Authorization: Bearer $($inner.key)" `
  -H "X-XAI-Token-Auth: xai-grok-cli"
```

### 真实响应(HTTP 200,2026-08-21 实测,本账户本周已用满)

```json
{
  "config": {
    "currentPeriod": { "type": "USAGE_PERIOD_TYPE_WEEKLY",
      "start": "2026-08-15T19:39:23+08:00", "end": "2026-08-22T19:39:23+08:00" },
    "creditUsagePercent": 100.0,
    "onDemandCap": { "val": 0 },
    "onDemandUsed": { "val": 0 },
    "productUsage": [ { "product": "GrokBuild", "usagePercent": 100.0 } ],
    "isUnifiedBillingUser": true,
    "prepaidBalance": { "val": 0 },
    "topUpMethod": "TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
    "billingPeriodStart": "2026-08-15T19:39:23+08:00",
    "billingPeriodEnd": "2026-08-22T19:39:23+08:00"
  }
}
```

字段含义(与官方 `billing.rs` 结构体一一对应):
- `creditUsagePercent`:包含额度已用百分比(优先展示字段);
- `currentPeriod`:当前周期(weekly/monthly),`end` 即重置时刻;
- `productUsage[]`:分产品消耗(GrokBuild = 编码 CLI);
- `monthlyLimit`/`used`/`billingPeriodStart/End`:旧版字段,仍可能返回,作兼容回退;
- `prepaidBalance`:购买的 Extra Credits 余额(美分);`onDemandCap/Used`:按需上限/已用;
- `history[]`:历史周期用量(billingCycle 年月 + includedUsed/onDemandUsed/totalUsed 美分)。

### 关联端点

- `GET /v1/auto-topup-rule` → 同样两头部,实测 200 `{}`(空对象 = 未启用自动充值;启用时返回 `{rule:{enabled,minBeforeHittingSl,topupAmount,maxAmountPerMonth}}`)。
- **已知差异**:响应里没有 `subscriptionTier` 和 `onDemandEnabled`——CLI 是从 RemoteSettings(remote config)合并进来的。UI 要显示"SuperGrok"字样,可从本地日志的 `subscriptionTier` 取,或硬编码映射。

### 认证来源与刷新

- JWT 存于 `~/.grok/auth.json`,6 小时时效,CLI 用 `refresh_token` 向 `https://auth.x.ai` 静默刷新并回写文件。
- 集成侧**每次请求前重读 auth.json 即可**(文件 IO 开销可忽略);若遇 401,提示用户开一次 Grok CLI 让它自行刷新,不要自己实现 refresh(rotation 冲突风险)。

### 频率限制

- CLI 自身每 ~30s 轮询一次未见限流;端点无 `X-RateLimit-*` 头。建议集成轮询 ≥30–60s。

## 风险与限制

1. **接口未文档化但已开源佐证**:请求构造与响应 schema 在 `xai-org/grok-build` 开源仓库中有权威定义(billing.rs),变动风险显著低于纯逆向端点;但仍属内部 API,需容错解析。
2. **只有百分比无绝对量**:`creditUsagePercent` 是唯一主指标;Credits 绝对值不可得(旧版 `monthlyLimit/used` 美分字段在新账单体系下不再返回)。
3. **JWT 6 小时过期**:依赖 CLI 保活刷新;长期不开 CLI 的用户会 401,UI 需有"打开一次 Grok 刷新登录"引导。
4. **ToS**:用自己的凭据只读查询自己账户,与 CLI 行为一致,低风险;勿高频轮询。
5. 本地日志方案保留为兜底:仅会话期间更新、字段是子集。

## 建议

1. **主采集**:30–60s 轮询 `/v1/billing?format=credits`,两固定头 + 现读 auth.json;解析 `creditUsagePercent` + `currentPeriod.end` 做进度条和倒计时,`productUsage` 可做分产品明细。
2. **降级链**:API 401/网络失败 → 读 unified.jsonl 最近一条快照(带日志时间戳标注"最后更新");两者都无 → 提示未登录。
3. UI 补充:订阅层级从日志 `subscriptionTier` 或 remote settings 兜底;`prepaidBalance>0` 时显示 Extra Credits 余额卡。
4. 与 ccusage 的 token 统计互补:百分比=还剩多少额度,token=用了多少量。
5. 关注 `xai-org/grok-build` 仓库 billing.rs 的变更(开源 = 可 diff 监控),schema 变动可提前感知。