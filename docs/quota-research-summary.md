# Quota 采集调研汇总

> 调研日期:2026-08-21 · 本机 Windows 11(用户 `C:\Users\funzza`)· 5 家订阅全部实测验证
> 交付物:本汇总 + 5 份独立报告(`quota-research-{kimi,grok,gpt,opencode-go,alibaba-token-plus}.md`),均含脱敏真实响应与完整路径。

## 总览

| 订阅 | 可行性评级 | 推荐采集方式 | 关键数据源 | 额度周期 | 单位 | 轮询建议 |
|---|---|---|---|---|---|---|
| **Kimi** | 🟢 高(API+本地双通道) | `kimi web` 本地服务 REST | `GET 127.0.0.1:58627/api/v1/oauth/usage`(Bearer `~/.kimi-code/server.token`) | 周滚动(7天)+ 5小时限流 + 并发 | 无量纲 used/limit(100) | 30–60s |
| **GPT(Codex)** | 🟢 高(官方 API) | 云端 API(推荐) | `GET https://chatgpt.com/backend-api/wham/usage`(Bearer `~/.codex/auth.json` access_token,10 天有效) | 5h 滚动 + 周滚动(本机 Plus 当前仅周窗口) | 百分比 + credits 美元余额 | 60s(官方 CLI 同频) |
| **OpenCode Go** | 🟢 高(官方 API) | 云端 API | `GET https://opencode.ai/zen/go/v1/usage`(Bearer `~/.local/share/opencode/auth.json` 的 `opencode-go.key`) | 5h 滚动($12)+ 周($30)+ 月($60) | 美元金额,API 返回百分比 | ≥60s |
| **Grok** | 🟢 高(官方 API,二次深挖后破解认证) | 云端 API | `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`,头:`Authorization: Bearer <auth.json key>` + `X-XAI-Token-Auth: xai-grok-cli`(固定串),实测 200 | 7 天固定窗口 | Credits 百分比 + productUsage 分产品 | 30–60s |
| **阿里 Token Plus** | 🔴 低(部分可行) | 本地聚合 + 429 被动信号 | `opencode.db` token 统计 + 429 错误体里的重置时间;无公开额度 API,本机 sk-sp Key 已失效 | 5h + 7 天双窗口(Credits 制,个人版) | Credits | 事件驱动 |

## 额度体系对比

- **共同点**:除 OpenAI 外全部以"百分比 + 重置时间"暴露额度(各家均不给绝对剩余量);周期主流是"5 小时滚动 + 周/月窗口"双轨制。
- **差异**:
  - Kimi 特有:会员共享 token 池(月度,不在此接口内,需网页)+ 加油包 RMB 余额。
  - OpenAI:Plus 当前实测只有周窗口(5h 窗口被官方动态关闭),**UI 必须按 `limit_window_seconds` 动态渲染**。
  - OpenCode Go:唯一按美元计费($12/$30/$60),文档明示限额可能调整。
  - Grok:SuperGrok 统一账单,`creditUsagePercent` + 精确 `currentPeriod.end`。
  - 阿里:5h 限额处于"限时取消/恢复"波动中,7 天窗口自首次调用起算,非自然周期。

## 采集方式汇总

### 方式 A(本地,无凭据风险)
- **Kimi**:本地服务 `kimi web` 本身就是官方文档化代理,读 `server.token` 即可,还自动处理 token 刷新。
- **Codex**:sessions JSONL 的 `token_count.rate_limits` 快照适合做兜底/历史曲线;`codex app-server` RPC 也可用但 schema 漂移大。
- **Grok**:日志含完整额度快照,作 API 故障时的兜底(仅会话期间每 ~30s 更新,字段是 API 响应的子集)。
- **阿里**:本地只有 token 统计(ccusage 同源),无 Credits 折算;429 错误体是唯一精确重置时间信号。

### 方式 B(官方 API,均为未文档化"事实存在"接口)
- **5 家中 4 家有可用端点**:Kimi(`api.kimi.com/coding/v1/usages` 或本地代理)、OpenAI(`/wham/usage`)、OpenCode Go(`/zen/go/v1/usage`)、Grok(`cli-chat-proxy.grok.com/v1/billing?format=credits`,认证已破解:Bearer JWT + `X-XAI-Token-Auth: xai-grok-cli` 固定串;且 grok CLI 官方开源 `xai-org/grok-build`,billing.rs 为权威 schema 参考)。
- 认证一律复用 CLI 已登录凭据文件,**无需用户新申请 API key**;token 过期由各 CLI 自动刷新,集成侧不要自行实现 OAuth refresh(rotation 冲突风险)。

## 集成优先级建议

1. **第一优先:OpenCode Go** — 端点干净稳定(3 窗口、200 实测、错误语义清晰),key 静态可复用,风险最小。自研产品的订阅配额是自家功能核心。
2. **第二优先:Kimi** — 官方文档已收录本地 API,双通道,信息最全(周/5h/并发/加油包),但注意本地服务端口探测与"实验性"标注。
3. **第三优先:GPT/Codex** — 端点成熟(官方 CLI 自己 60s 轮询同端点),社区生态验证充分;风险是窗口动态开关与 Cloudflare 403。
4. **第四优先:Grok** — 认证已破解(两固定头,实测 200),且官方开源仓库可 diff 监控 schema 变动;注意 JWT 6h 时效依赖 CLI 保活刷新,保留日志快照做降级。
5. **第五优先:阿里 Token Plus** — 无公开 API;先做本地 token 聚合 + 429 信号 + 控制台深链;待拿到有效 sk-sp Key 或阿里开放 OpenAPI 后再升级。

## 共同风险

- **接口均为"事实存在"**:无官方契约,变动史明确(OpenAI 已换 3 代端点);所有解析需容错降级,失败时回退本地统计。
- **百分比无绝对量**:4/5 家的"剩余"只能展示百分比 + 重置倒计时;绝对值需 ccusage 的 token 统计补足,两者互补。
- **凭据安全**:全部凭据明文存于本地 JSON;Electron 读取后须内存化,严禁写日志/渲染进程;报告已全员脱敏(通过自动化扫描:无 sk-/eyJ/Bearer 明文、无邮箱/UUID 泄露)。
- **轮询频率**:统一 ≥30–60s,响应头无限流指示,高频会被 429。
- **ToS**:用自己的凭据只读查询自己账户用量,与各 CLI 自身行为一致,属低风险灰色地带;禁止爬他人数据。

## 交付文件

| 文件 | 评级 | 大小 |
|---|---|---|
| `quota-research-kimi.md` | 高(API+本地) | 9.8KB |
| `quota-research-gpt.md` | 高(官方 API) | 11.2KB |
| `quota-research-opencode-go.md` | 高(官方 API) | 10.0KB |
| `quota-research-grok.md` | 高(官方 API,认证已破解) | 10.5KB |
| `quota-research-alibaba-token-plus.md` | 低(部分可行) | 9.9KB |

所有报告含:结论 / 额度体系 / 方式A(路径·格式·脱敏示例·更新时机·覆盖度)/ 方式B(URL·认证·curl·脱敏响应·频率限制)/ 风险与限制 / 建议。附:阿里调研的探测脚本与 DB 只读副本在 `Z:\Temp\opencode\quota-research\`(临时,可删)。