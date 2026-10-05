# UI Iteration Latest

## 发布接续：2026-10-05 商用候选版

- 用户要求提交、push、合并，并明确确认允许本次 Vercel 自动部署/计费；此前“不提交、不推送”约束在本次发布范围内解除。
- 生产撤权 migration、18 项权限验证与 262 项数据库健康对账已完成。沿用最终代码的 lint、typecheck、216 项单元、52 项浏览器、build 和 8 项本地生产 HTTP 结果；本次先核对提交范围、凭据、差异及远端，再通过 PR 发布。
- 当前 `codex/...` 分支与远端已有 `codex` 名称冲突，使用独立 `commercial-candidate-20261005` 分支，不直接 push main；不覆盖其他 PR 或远端分支。
- 外部准入 S38 保持待办：Auth 公共 signup、邀请名单与部署 secrets、真实媒体/邮件/Push、iOS/Android 真机、备份恢复。合并不代表这些项目通过，发布结果由 PR/CI 记录确认。

---

## 续验：2026-10-05 S38 实网只读预检与执行表

### audit / select / implement

- 用户同意开始实网、真机与商用准入验收；保持不提交、不推送、不部署。选择 S38 可执行的资源盘点、公开 Auth 设置检查和恢复演练准备；没有 UI 或产品代码改动。
- 读取 AGENTS、商用/浏览器台账、Auth 客户端/注册 API/回归、媒体签名、Push/提醒 secret 入口、manifest；按 Supabase / PWA 技能边界检查。官方文档核对 Auth 开关和数据库备份不包含 Storage 对象的限制。
- 新增 `docs/commercial-acceptance-runbook.md`：实际预检与待执行项分开；明确资源字段、Auth 开关目标、五身份业务矩阵、iOS/Android 分开记录、数据库+媒体恢复步骤、精确清理和无凭据证据格式。
- 更新 `docs/commercial-readiness.md`、TASKS_UI 和本记录。API/RPC/migration/schema/生产 Auth 配置均未修改。

### validate / review

- 相关 fchat 项目 ACTIVE_HEALTHY，现有隔离分支列表为空；未借用无关项目或创建付费资源。
- 对已核对的 fchat 主机，以现有公开 key 只读 GET `/auth/v1/settings`：HTTP 200，`disable_signup=false`、email=true、anonymous_users=false、mailer_autoconfirm=false。只输出这些布尔值，不输出 key/token、账号或家庭内容；无账号创建、邮件或业务数据写入。
- **发现 E04 未通过**：直接公共 Auth 注册仍开启；应用层邀请名单不能关闭该入口。当前注册调用服务端 admin.createUser，客户端没有 signUp，但仍需在隔离环境验证关闭公共 signup 后的注册/登录/密码恢复。
- Supabase connector 无 Auth 配置写入工具；浏览器管理台进入登录页，已保留供用户接续，未输入凭据或修改配置。
- 本轮只改文档，运行 `git diff --check` 与新增文档空白检查；不重复运行未变更产品代码的 216/52 项回归，也不将上一轮本地通过算成本轮实网通过。
- UX：保留既有页面；设备/键盘/麦克风/真实系统通知尚未操作。Security：无生产数据导出或恢复、无 Storage 对象、无 Push/cron 外发，备份产物与凭据禁止进入 Git/报告。

### record / continue

- S38 保持未完成。需要管理台登录来处理 E04，以及完整隔离测试 URL、具体 iOS/Android 设备；测试邮箱和恢复目标在资源表补齐后执行业务与恢复流程。
- 缺少可操作资源时明确记录未执行，不创建收费测试项目、不改生产数据来代替隔离验收。完成外部准入之前仍为商用候选版。
- 回退仅涉及本轮文档段落与新增执行表，前序补丁全部保留；没有 commit/push/PR/Vercel 操作。

---

## 本轮：2026-10-05 商用候选版的身份、入口安全与维护版本

### audit / select

- 用户要求持续修改优化至商用，首版范围为“可邀请家庭正式使用”；继续不提交、不推送，最后统一验收。保留之前所有未提交修改。本轮没有视觉重做，业务修复按 AGENTS 执行。
- 选择 S35 / S36 / S37（P0：身份与媒体缓存、服务端入口、安全维护版本）和 S38 的可执行数据库部分；隔离实网地址与 iOS/Android 设备仍未明确提供，“是的”不足以完成实操验收。
- 使用 fullstack-architect、bug-fixer、next-upgrade、diagnose、supabase-engineer / supabase 技能；阅读相关代码、UI 治理和官方/安装包 Next.js 16 迁移说明。保留混合身份、授权 RPC、recipient、family_seq、Realtime 安全信号、Push 和 Storage 签名架构。
- 邀请制是缺少开放注册选择回复时采用的推荐默认方案；服务端邮箱名单为空则关闭新创建者，既有家庭登录和家庭代码加入保留。不能用网站名单代替 Supabase Auth 公共 signup 配置。

### implement / 修改文件

- 身份恢复：`app/page.tsx`、`app/join/page.tsx`、`app/album/page.tsx`、`app/members/page.tsx`、`app/settings/page.tsx`、`app/me/page.tsx`、`app/schedule/page.tsx`、`app/image-preview/page.tsx`。请求与确认框后核对发起时身份/共享版本，旧响应不保存/清空替换会话；加入页暂时网络失败不删除成员身份。成员/相册/设置的读取、移除及 owner 操作保留服务端授权。
- 已显示内容：新增 `components/MemberSessionBoundary.tsx`，`app/layout.tsx` 将私有页面及 Dialog 放入身份边界；共享退出或切换使旧私有内容与弹窗卸载，首页接管新身份。
- 媒体：`lib/mediaCacheStore.ts`、`lib/mediaClient.ts`、`lib/imageCache.ts`、`lib/authLocal.ts`。v3 Cache API 键带家庭/成员/随机会话版本，签名请求也分版本；旧下载拒绝、迟到 put 撤销自身旧键、延迟清理保留新登录版本。128 项/64 MiB 上限保留；无法保存共享版本时不持久化。不将 token/hash 写入缓存元信息。
- 服务端：`lib/apiSecurity.ts` 读取时执行 16KiB 流式限额及严格 UTF-8/JSON；8 个 `app/api/auth/*` POST 同步使用并核对 Origin。`app/api/push/diagnostics/route.ts` 与 `lib/pushNotificationService.ts` 使用 POST JSON/no-store，token 不进入 URL；成员与家庭查询过滤保留。Push 订阅/取消/健康读取补身份边界，远端取消失败不声称成功。
- 邀请和邮件：新增 `lib/registrationServer.ts`，register/family-code/create-family 服务端核对邀请名单；`lib/accountServer.ts`、`app/api/auth/resend-existing-family-code/route.ts` 利用既有时间戳做 60 秒冷却/原子认领，首次 pending 使用已有主键防并发，数据库限流故障停止邮件，配额满不持续扩充尝试表；邮件错误只记录状态，不输出 Provider 正文。`lib/errors.ts`、`lib/i18n.ts`、`.env.local.example` 补文案/配置。
- 数据库：新增 `supabase/migrations/20261005_revoke_legacy_family_creation.sql`，同步 `supabase/schema.sql`；仅撤销旧 4/5 参数 create_family 的 PUBLIC/anon/authenticated execute 并登记版本。`lib/admin/systemHealth.ts` 增加 migration 与旧权限检查，移除当前 server API 已取代且无调用者的 verify_pending_family_code 要求。未新增/重写 RPC、表、RLS、消息或日程模型。
- 维护版本：`package.json`、`package-lock.json`、`next.config.mjs`、`tsconfig.json`、`next-env.d.ts`、`eslint.config.mjs`、`vitest.config.mts`、`.github/workflows/ci.yml`。按 14→15→16 迁移，当前 Next.js 16.3.8/React 19.3.0；Webpack 保留，lint 改 ESLint CLI，typecheck 先 typegen，CI Node 22 和生产 audit。移除旧 eslint/Vitest 配置，更新 Next Image 版本查询白名单和本仓库 tracing root；关闭遮挡移动输入栏的开发徽章，错误覆盖层保留。离线页保留完整导航，补局部 lint 原因。
- 最终回归发现的聊天滚动：`app/chat/page.tsx`、`tests/browser/message-history.spec.ts`。观测证明发送后 180/520ms 延迟回调把旧消息定位拉回底部；新增受控释放 520ms 回调用例先失败，修复离开底部时使旧 frame/timer 失效，ResizeObserver 执行前复核请求版本与靠近底部状态。原 1000 条发送/撤回/重复 Realtime 断言保留，临时 DEBUG 观测已删除。
- 回归文件：`lib/apiSecurity.test.ts`、`lib/accountServer.test.ts`、`lib/admin/systemHealth.test.ts`、`lib/mediaCacheStore.test.ts`、`lib/mediaClient.test.ts`、`lib/imageCache.test.ts`、`lib/pushNotificationService.test.ts`；`tests/pushDiagnosticsRoute.test.ts`、`tests/registrationRoute.test.ts`、`tests/recoveryEmailRoute.test.ts`；`tests/browser/member-session.spec.ts`、`tests/browser/message-cache.spec.ts`、`tests/browser/message-history.spec.ts`；`tests/database/permission-matrix.sql`。
- 文档：README、AGENTS、DESIGN_SYSTEM 技术基线、TASKS_UI、`docs/browser-regression.md`、`docs/commercial-readiness.md` 和本记录。完整准入、风险及手动步骤由商用台账记录。

### validate

- `npm run lint`：最终代码通过。`npm run typecheck`：通过，已修正新增测试中 DOM/Node 定时器重载与测试控制函数类型。
- `npm run test`：35 文件、216 项全部通过；真实 route 单元执行实际函数，数据库/网络使用合成模拟，不能替代实网。
- `npm run test:e2e`：完整 52 项全部通过（2.4 分钟）。滚动原场景/新增用例各重复 3 次通过，测试类型修正后新增用例再次通过。没有降低断言、force click 或自动 retries。
- UI/UX 回归：360/390/430px、520px 压缩视口、1000 条分页、图片/语音/位置/悄悄话/撤回、日程草稿、Dialog 焦点、通知定位、原生录音与原生缓存、双标签页身份通过。压缩视口/合成音频不代表真实手机软键盘/麦克风/Push。
- `npm run build`：通过，Next.js 16.3.8 Webpack 生成阶段 38/38 完成，无构建警告。构建后独立 typecheck 再次通过。浏览器服务与构建顺序执行。
- 本地生产模式 HTTP 冒烟：8 项通过（首页/聊天/日程/离线 200，诊断 GET 405、超限请求 413，未邀请注册及跨 Origin 拒绝 403）。使用合成拒绝名单和服务端配置，仅监听 loopback，不使用真实身份或远端写入；3101/3102 服务已回收。
- 依赖审计：最终生产 audit 0 项；完整 audit 仍有 7 项 high 开发依赖，集中于无补丁 braces 构建工具链。受控仓库 glob 不接受用户模式，详细边界见商用台账；不写成“所有依赖无漏洞”。
- 数据库：已核对目标 fchat 项目，在生产应用上述撤权 migration。应用前旧签名已无匿名权限；应用后 migration/旧权限/现代 owner 服务端 grant/private buckets 对账通过。18 项实际 anon 权限测试通过，所有合成数据和触发器行回滚，Storage 对象 0、Push 请求 0。
- 当前健康 catalog 的数据库范围 262 项通过、0 失败、0 警告；不含需要部署环境验证的 secrets，不能视为新前端已经发布后的完整 HTTP 健康结果。
- 最终 `git diff --check` 与未跟踪源码空白/冲突标记检查：通过，单次 core.safecrlf=false 不修改 Git 配置。DEBUG 观测代码已无残留。

### review / record / continue

- UX / a11y：保留 dynamic viewport、safe area、聊天输入/工具/录音与日程抽屉。历史滚动优先于先前发送的跟随；用户自己的新发送仍滚到底部。没有 SaaS 化或页面重做。
- Security：本地版本仅管异步生命周期，服务端仍校验 active 身份、family membership 和 recipient。API token 只在请求体；Push、Realtime 和诊断无消息正文/媒体/坐标。短期签名 URL 在过期前仍可持有，不能声称即时撤销。
- 风险：框架大版本升级已覆盖本地业务，仍需 PWA 真机；旧图片缓存会丢弃并经授权联网重建。邀请名单、Auth 公共 signup、邮件域名、cron/VAPID 与部署 secrets 需配置和实网确认。React Compiler 未开启，新 Compiler lint 规则单列后续，不夹带全站重构。
- S35/S36/S37 本地修复、安全维护版本与数据库验收完成。S38 保留待办：可操作隔离环境 URL、iOS/Android 设备、真实 HTTP 媒体/邮件/Push、备份恢复与运营准入。缺少这些证据时只能称商用候选版。
- 没有 commit、push、PR、Vercel 操作或前端部署。后续发布仍须明确获得 Vercel 自动部署/计费确认。回退只处理本轮局部补丁并重建依赖/缓存；不整仓 reset、不删除服务器数据、不重新开放旧匿名创建入口。

---

## 本轮：2026-10-05 聊天历史与身份缓存稳定性

### audit / select

- 任务来源：用户授权执行 `docs/message-stability-plan.md` 三步计划，前两步只实现和编写回归，第三步统一测试；保留已有未提交修改。
- 选择 S32 / P1（历史增量合并）、S33 / P1（身份失效与缓存竞态）、S34 / P1（统一验收）。按 AGENTS 的消息一致性和本地隐私修复执行，保持布局、消息模型和权限架构。
- 阅读 AGENTS、UI_RULES、DESIGN_SYSTEM、TASKS_UI、CODEX_UI_LOOP、迭代模板/最近记录、聊天页面、输入/消息组件、身份恢复、缓存/同步/通知及原有回归。使用 chat-system-engineer、bug-fixer 技能。
- 数据流继续由授权 RPC 提供完整消息，Realtime 只传轻量信号；recipient、active 成员、family_seq、媒体签名及 Push 安全摘要规则保持。

### implement / 修改文件

- `app/chat/page.tsx`：缓存快照与当前列表按 ID 增量合并，分页在提交时保留最新列表；覆盖启动、单条/批量 Realtime、通知、文字/图片/语音/位置发送及撤回。所有相关异步操作保留发起时身份/会话版本，过期后不更新消息、提示或发起后续写入。已被服务端接受的发送保留原有 Push 请求。
- `lib/messageList.ts`：拒绝跨家庭消息、旧修订及撤回后的旧正文；服务器 seq 可确认乐观消息，临时上传预览/状态在同 ID 快照中保留。
- `lib/messageCacheLifecycle.ts`、`lib/authLocal.ts`：退出/切换先同步使版本失效，再异步清理。随机版本跨标签页共享，结合 storage 事件及各边界直接核对；凭证只用于已有 session 和内存比较，不新增 token/hash 持久化副本。普通资料刷新继续有效。
- `lib/messageCache.ts`：消息/同步状态带会话版本；旧上下文不能写入，进行中的事务失效时中止，延迟清理仅删除旧版本。容量仍为 1000 条、默认读取仍为 100 条；只按当前版本计算读取窗口，持久化剔除临时预览/上传字段。数据库版本 1 和索引不变。
- `lib/messageNormalization.ts`、`lib/messageService.ts`：原有规范化逻辑原样移入纯模块并保持旧导出，缓存不再运行时依赖 Supabase 客户端。`lib/messageSync.ts`、`lib/notificationMessageSync.ts`：请求版本贯穿分页、降级、缓存和回调；过期返回 cancelled，停止旧兜底。缓存不可用时保留 RPC 成功消息；同步锁释放核对操作 ID，通知重登不复用旧请求。
- 单元回归：`lib/messageList.test.ts`、`lib/messageCacheLifecycle.test.ts`、`lib/messageSync.test.ts`、`lib/notificationMessageSync.test.ts`、`tests/helpers/localSession.ts`。
- 浏览器回归：`tests/browser/message-cache.spec.ts`、`tests/browser/message-history.spec.ts`、`tests/browser/recording-notification.spec.ts`、`tests/browser/fixtures.ts`。使用实际缓存源码与原生 IndexedDB、真实页面和双标签页；通知使用 1200 条合成历史的早期目标，语音发送与长历史组合。模拟仅在测试中，无产品测试权限入口或新增依赖。
- 验收中修复：旧版本行占用当前缓存窗口；缓存完成与 UI 回调之间补身份检查。Realtime 先触发新消息副作用并即时登记 ref Set，再在缓存完成后只合并列表；新增用例先复现动画漏触发，再验证重复事件不重播。
- 夹具修正：缓存测试自动初始化合成身份并使用合成 HTML；缓存观察不创建空库；新标签页空白页不访问 localStorage；同身份重登等待首页恢复完成，撤回断言使用实际文案。保持功能断言与严格网络拒绝。
- API / RPC / migration：本轮没有服务端 API、RPC 签名、schema、RLS、grant 或 Storage 策略改动，无 migration；Push payload 和 SW 未修改。先前轮次的未提交补丁保留。

### validate

- 遵守最后统一测试；实现完成后才运行各检查，验收中发现的问题修复后重跑。
- `npm run lint`：最终代码通过，无警告或错误。
- `npm run typecheck`：最终代码通过，构建后再次独立执行通过。
- `npm run test`：29 个文件、184 项全部通过，包括缓存结束与回调之间失效、锁归属、缓存失败及通知重登。
- `npm run test:e2e`：最终完整 41 项全部通过（3.8 分钟），包括 7 项原生缓存、5 项历史/身份组合及前序 29 项回归；独立无头 Chrome、合成媒体/身份、模拟 RPC/Realtime，严格拒绝未声明流量。
- 移动宽度 / 功能：360/390/430px 和 520px 压缩高度通过，日程评论输入/发送可达，聊天无横向溢出；1000 条分页、1+1 个消息观察器及离开释放、锚点/菜单、悄悄话/媒体、录音取消/正常发送、连续通知目标均通过。图片上传中 Realtime 动画只触发一次，缓存回写不重播。
- `npm run build`：通过，39 个页面生成完成；仅保留 Browserslist 数据过旧提示，未更新依赖。与浏览器服务顺序执行。
- `git diff --check`：通过，使用单次 `core.safecrlf=false` 抑制换行提示，未修改 Git 配置。
- 测试资源：浏览器服务已退出，3101 端口无监听；没有硬件麦克风、实网通知、生产媒体上传或真实数据截图/日志。
- 实网 / 真机：当前未提供可操作的隔离测试环境或 iOS/Android 设备，未执行 HTTP 签名/Storage/系统 Push 或真机键盘/麦克风验收；没有重复执行上一轮生产 RPC 回滚检查。

### review / record / 后续

- UX / a11y：保持 dynamic viewport、底部输入栏、原有媒体/菜单/悄悄话和滚动锚点；本轮没有样式或交互入口改造。浏览器合成音频与压缩视口不能证明真机麦克风/键盘行为。
- Performance：本地读取和保留上限不扩大，页面已加载历史在内存合并；写入增加版本及修订检查，不声称实测帧率提升。
- Security / architecture：本地版本只处理异步失效，不代替服务端权限；不扩展敏感日志或通知字段。旧本地无版本缓存首次需要经授权 RPC 重建，联网完成前离线历史可能暂缺；服务器消息不受影响。
- 外部验收按 `docs/message-stability-plan.md` 的五身份 HTTP 媒体权限矩阵及 iOS/Android PWA 步骤执行，精确清理本轮合成 Storage 对象并核对残留。没有可操作的环境/设备时继续保留未验收状态。
- 任务记录：S32 / S33 完成；S34 的本地阶段完成，整体仍保留外部验收待办，不用本地通过替代实网/真机通过。
- 回滚只恢复本轮补丁并重建本地缓存，保留前序修改；不删除服务器消息、不整仓 reset。没有提交、推送、PR、Vercel 操作、部署或生产写入。

---

## 续验：2026-10-05 录音取消、通知回流与实际 RPC 权限

### audit / select

- 任务来源：用户同意继续上一轮真机/权限验收建议，继续保留本地、不提交或部署。当前无可操作的 iOS/Android 手机，先完成本地与服务端可执行部分。
- 选择 S30 / P1（录音与通知时序业务防护）和 S31 / P1（权限回归/配置对账）；按 AGENTS 的业务隐私修复执行，不作为视觉改造。
- 阅读聊天输入、日程详情/媒体上传、录音服务、消息通知、SW、注册组件、Push API、前后台 presence、媒体签名、成员校验、canonical schema，以及 UI 治理文档和上一轮记录。
- 使用 pwa-push-engineer、chat-system-engineer、supabase-engineer / supabase 技能。保持 membership/token、recipient、私密可见性、RPC、Storage 签名和 Push 安全摘要架构。

### implement / 修改文件

- `lib/recordingService.ts`、`components/ChatInput.tsx`、`app/schedule/page.tsx`：录音开始支持取消信号；授权响应晚到时释放流且不启动录音；取消、后台/视口变化、离开或日程切换失效旧操作。日程语音上传沿用现有可取消 XHR，关闭后中止，不再发起旧详情写入。已被服务端接受的记录保留协作通知，关闭后抑制旧 UI 提示。
- `public/sw.js`、`app/chat/page.tsx`：只有通知点击的客户端信号新增 `openedFromNotification: true`；窗口导航失败时页面更新目标并恢复锚点，检查同家庭及 UUID。明确目标取消旧的滚底动画帧/延迟任务并短暂抑制自动滚底，避免第二次通知目标被覆盖。普通 Push 到达不新增该标记。
- `lib/recordingService.test.ts`、`tests/serviceWorker.test.ts`、`tests/mediaSignRoute.test.ts`、`tests/browser/recording-notification.spec.ts`、`tests/browser/fixtures.ts`：录音生命周期、通知点击/安全信号/清理、真实媒体签名 route 的拒绝路径、真实页面与原生 MediaRecorder 合成音频回归。
- `tests/database/permission-matrix.sql`：两户合成家庭、五种成员身份，以实际 anon 权限调用现有 RPC；异常子事务强制回滚并复核无残留，仅输出通过项与回滚状态。
- 文档：`docs/browser-regression.md`、`TASKS_UI.md`、本记录。
- API / RPC / migration：没有新增 API、修改现有 API/RPC 参数或数据库权限；没有 migration。SW→页面信号新增可选布尔字段，服务端 Push payload 不变。

### validate

- `npm run lint`：通过，无警告或错误。
- `npm run typecheck`：最终构建后独立执行通过。
- `npm run test`：28 个文件、167 项全部通过。
- `npm run test:e2e`：最终整组 29 项全部通过（1.3 分钟），独立无头 Chrome 与合成数据。覆盖新增 16 项录音/通知回归和原有 13 项页面回归；本轮没有使用硬件麦克风、真实 Web Push 或生产媒体上传。
- 浏览器复核发现并修复：连续通知定位被旧滚底任务覆盖；等待授权期间移出日程录音按钮需要立即取消。用例修正为实际同意值与按钮名称，合成图片改为正常点击尺寸，未删除或降低功能断言。
- 正常聊天/日程原生 MediaRecorder 合成音频各只上传及写入一次；上传中关闭中止 XHR，已提交记录的通知仍请求；晚授权、后台/视口变化、关闭/切换不发送；取消后能重新开始。冷通知入口、连续目标、晚响应、导航失败信号、外家庭信号隔离均通过。
- 360/390/430px 无横向溢出，520px 压缩高度关键评论操作可达；1000 条合成消息在真实页面中分页加载，仍使用 1+1 个观察器，离开后释放，锚点/媒体/菜单回归通过。
- `npm run build`：通过，39 个页面生成完成；仅提示 Browserslist 数据过旧，未更新依赖。
- `git diff --check`：通过；使用单次 `core.safecrlf=false` 抑制 LF/CRLF 提示，未修改 Git 配置。
- fchat 生产权限回归：17 项通过，实际 RPC 角色 anon；发送者/接收者允许，非参与成员/管理员/跨家庭成员拒绝，移除后的旧 token 读写拒绝；数据库消息/日程媒体 recipient 来源符合边界。全部合成数据和触发器写入已回滚，脚本再次核对家庭、成员、消息、日程、记录不存在；没有创建 Storage 对象或请求 Push。
- 项目对账：生产回归目标与本仓库公开 Supabase URL 一致，仅记录匹配结果，未输出环境密钥。
- 受限配置对账：7 张相关敏感表开启 RLS，anon/authenticated 无直接 select 权限，anon 无直接 insert 权限；所查入口 RPC 均为 SECURITY DEFINER、固定 search_path 且授予正确执行角色；无效成员验证返回空；图片/语音 bucket 均 private。未把无敏感读写的可见性 helper 当成入口 RPC。

### review / record / 限制

- UX：保持现有布局和交互入口；正常录音松开发送，取消和晚响应不恢复旧录音；通知只在点击后恢复目标。
- Security：未写真实 token/hash、家庭代码或消息正文到输出、URL、通知；测试凭证/内容均为合成。数据库回归不等于生产 HTTP 签名或实网 Push 端到端验证。
- 完整生产 RPC 源码导出被自动审批拒绝，理由是可能泄露内部实现；未重试或绕过，改用本地 schema、受限配置对账及实际 RPC 的合成回滚测试。旧的项目级 Supabase MCP 未认证，已使用正常连接的 Supabase app。
- 仍需真机：iOS/Android PWA 软键盘、safe area、系统麦克风权限与真实录音、前后台连续系统通知点击。当前没有可操作的手机设备；浏览器合成音频/信号/压缩视口不能代替这些步骤。
- 浏览器独立服务已回收，3101 端口连接被拒绝；没有提交、推送、PR、Vercel 操作或部署。
- 回滚仅需恢复本轮录音和 SW→页面信号补丁；数据库测试无持久化结构/数据变更。此前优化与用户原有修改保留。

---

## 本轮：2026-10-05 稳定性、长聊天与固定浏览器回归

### 基本信息 / audit / select

- 任务来源：用户要求逐项仔细核对三步优化，最后统一测试，继续不提交。
- 选中任务：S27 / P1（日程与个人页异步稳定性）、S28 / P2（聊天观察器与消息行）、S29 / P1（固定浏览器回归）。S27 按 AGENTS 的业务修复执行，不作为视觉 polish；各步骤保持最小范围。
- 已阅读 AGENTS、UI_RULES、DESIGN_SYSTEM、TASKS_UI、CODEX_UI_LOOP、迭代模板/最近记录及相关页面、服务、身份和缓存文件。
- 数据流：页面继续调用现有授权 RPC；Realtime 只触发详情读取；媒体继续通过原有签名/上传入口。保持 recipient、active 成员、私密可见性、缓存代次和 Push 安全摘要边界。

### implement

1. 日程后台刷新只更新服务器数据，保留评论、私密接收人、拒绝说明与编辑草稿；切换到不同事项时才重置输入。初次详情返回后不清空已经输入的文字；评论发送只清空本次提交的原稿。详情访问代次防止旧评论/编辑/响应操作完成后影响新详情；后台关联读取失败不清空现有数据或重复弹错误。个人页并发刷新共享请求，卸载/初始化变化/头像保存使旧响应失效；头像删除也检查取消与身份代次。
2. 每个聊天滚动容器共享 IntersectionObserver / ResizeObserver，最后一行卸载时释放；移除的行不再接收通知。新增 memo 消息行，稳定 DOM 注册回调，动作通过最新已提交的页面回调执行，保留锚点、content-visibility、媒体、长按和高亮。
3. 新增 Playwright `test:e2e` 与 13 个真实页面用例。测试使用独立本地服务、合成家庭、模拟 RPC/Realtime/上传与签名，拒绝未声明的接口和外部 HTTP 请求；无测试路由或前端权限绕过。CI 增加 Chromium 安装与浏览器回归。默认不生成截图、视频或 trace，测试上传不产生远端 Storage 对象。

### 修改文件

- 稳定性：`app/me/page.tsx`、`app/schedule/page.tsx`。
- 聊天：`app/chat/page.tsx`、`components/ChatMessage.tsx`、`components/ChatMessageRow.tsx`、`components/ChatMessageViewport.tsx`、`lib/chatViewportObserver.ts`、`lib/chatViewportObserver.test.ts`。
- 浏览器/CI：`playwright.config.ts`、`tests/browser/fixtures.ts`、`tests/browser/app-regression.spec.ts`、`package.json`、`package-lock.json`、`.github/workflows/ci.yml`、`.gitignore`。
- 文档：`docs/browser-regression.md`、`AGENTS.md`、`README.md`、`TASKS_UI.md`、本记录。
- API / RPC / migration：现有服务端接口、RPC 参数、数据库和 Storage 策略没有变更，无 migration；Push 与 Service Worker 没有修改。

### validate

- 用户要求所有实现完成后统一测试，步骤中未运行测试。
- `npm run lint`：通过，无警告或错误。
- `npm run test`：25 个文件、148 项全部通过；新增观察器资源上限、移除后的通知、重挂载/释放和降级检查。
- `npm run test:e2e`：使用本机独立无头 Chrome，最终整组 13 项全部通过（49.3 秒）。初轮因同名标题、按钮文案和导航入口假设导致用例定位失败，已修正为实际页面语义；语音按钮按含时长的可读名称定位，图片等待实际解码完成。
- 浏览器覆盖：Realtime 私密草稿/编辑保持、初次慢详情、关闭与 A/B 切换、提交时继续输入、个人页请求去重/过期头像/旧错误、Dialog Tab/Shift+Tab/Escape/焦点恢复、真实 XHR 取消、图片预览、生成音频播放结束、位置/悄悄话/撤回展示。
- 360px / 390px / 430px 的个人页、日程和 1000 条聊天无横向溢出；日程 520px 压缩高度下评论输入和发送按钮位于视口内。压缩高度是浏览器模拟，不等同于手机软键盘。
- 长聊天：实际分页加载 1000 条消息，消息观察器数量维持 1 个 IntersectionObserver 与 1 个 ResizeObserver，第 10/999 条锚点、消息菜单/Escape 可用；SPA 离开聊天后两类消息观察器均归零。保留全部 DOM，不宣称完整虚拟列表或帧率提升。
- `npm run build`：通过，39 个页面生成完成；仅保留 Browserslist 数据过旧提示，未自动更新依赖。
- `npm run typecheck`：独立执行通过。
- `git diff --check`：通过；Git 的 LF/CRLF 提示不影响检查结果。
- `test:lhci`：missing，未新增该脚本。
- 测试服务已回收，3101 端口连接被拒绝；无提交、推送、PR、Vercel 操作或生产写入。

### review / record

- UX / A11y：布局与视觉保持原样；输入/编辑不被后台刷新打断；弹窗焦点和取消路径、压缩高度下关键操作已验证。
- Performance：减少观察器资源与无关页面状态引起的消息行重渲染，完整 DOM 长历史的整体开销仍需真机测量。
- Security / Architecture：授权仍由现有 RPC/API 校验；新增 DOM 属性只包含已有可见消息 ID；不新增 token URL、敏感日志或 Push 内容。浏览器模拟不能证明生产权限正确。
- 下一步：按 `docs/browser-regression.md` 的矩阵，用测试家庭和 iOS/Android PWA 真机检查软键盘、麦克风、前后台/连续通知定位，以及非参与成员、管理员、被移除成员的服务端拒绝行为。本环境没有可操作的手机设备，本轮也没有执行生产多身份写入测试。
- 回滚：只恢复本轮页面异步/消息行/观察器补丁和新增测试配置；保留此前 S22–S26 及用户原有改动，不需要数据库回滚。

---

## 续验：2026-10-05 真实账号回归与头像退出防护

- 任务来源：用户同意继续真实场景回归，保持不提交、不部署。
- 范围：沿用 S22–S25 验收；新增 S26，修复个人页头像上传离开页面后可能继续更新头像/回填缓存的问题。
- 修改文件：`app/me/page.tsx`、`lib/avatarService.ts`、`TASKS_UI.md`、本记录。
- 修改：上传客户端新增可选 AbortSignal；个人页卸载或身份变化时取消上传，上传准备/完成、头像保存及缓存写入后的异步边界检查取消与缓存代次，忽略失效操作的 UI 和通知更新。
- API / RPC / migration：无服务端契约或数据库改动，无 migration。临时本地回归页、两个测试 API 和生成的本地测试文件已移除，本地回归服务已停止。

### 已完成的真实场景验证

- 本地默认地址已有有效成员会话，继续使用现有真实日程，没有新建/修改日程、发送聊天消息或修改成员头像。
- 临时页面仅控制真实 RPC 响应的交付顺序：日期切换、月份切换、类型筛选中旧响应晚到后，当前日期/月份/筛选和内容保持正确。
- 详情读取阻塞期间关闭，释放旧响应后详情未重新打开；先打开 A、关闭再打开 B，A 晚到响应未覆盖 B。
- A 的协作、上下文记录及提醒状态三类读取同时阻塞，切换 B 后再释放，B 的标题、负责人确认、记录和投递状态保持一致。
- 真实上传：生成的 96px TEST PNG、1 秒合成 WebM 测试音频和头像均通过既有 API 上传成功；图片进度到 100%，头像通过既有签名入口和真实 Cache API 显示。
- 未关联 message/context recipient 的新图片签名被服务端拒绝；仅验证当前成员及此测试图片，没有验证所有多身份权限矩阵。
- 浏览器 Cache API 命中、另一成员隔离、清理后拒绝旧代次回填通过；实际调用 clearSession/saveSession 验证退出和切换家庭均清理旧缓存，随后恢复原有效会话。
- 浏览器真实 XHR 连接本地停滞入口，120 秒后返回 upload_timeout；使用真实个人页和本地受控延迟上传入口，离开个人页后头像 XHR 触发 abort，未更新成员头像。
- 真实聊天：屏幕外历史语音初始延后加载，滚动接近后可用；已有语音进入播放态并正常回到停止态。
- 真实聊天 360px/390px/430px 的文档宽度和 scrollWidth 相等，无横向滚动；390px × 520px 压缩视口下输入栏底边 506px，输入可使发送按钮启用，测试输入已清空且未发送。压缩视口不等于真实软键盘。
- 真实日程详情在 360px/390px/430px 浏览器视口下无横向滚动，抽屉底边保持在 780px；390px × 520px 时抽屉底边为 520px，评论输入及发送入口位于视口内。输入测试未提交，临时文本已清空。
- 自动检查：最终 lint 无警告/错误，独立 typecheck 通过，24 个测试文件及 144 项测试全部通过，build 通过且生成 39 个页面，未包含任何临时回归路由，git diff --check 通过；仅保留 Browserslist 数据过旧提示。

### 清理、限制与后续

- 生成的三份服务端测试媒体尚待清理。热重载后通过本地缓存与生成 PNG 的 SHA-256 核对恢复测试头像引用；清理前的限时 Storage 元数据查询被自动审批拒绝，理由是可能读取同家庭时间段内其他文件。已询问用户是否允许核对并仅删除本轮测试对象，等待回复，未扩大查询或删除任何对象。
- 截图持久化被自动审批拒绝，理由是可能包含真实家庭内容；采用文字记录，没有保存或分享真实家庭截图。
- 待真机：iOS/Android PWA 软键盘、麦克风录音、safe area、通知点击回流；需多身份测试家庭验证私人日程及协作权限矩阵。当前无生产库结构变更，未执行 migration 或系统健康目录全量对账。
- 未提交、推送或部署。

---

## 本轮：2026-10-05 三步稳定性优化

- 执行者：Codex。
- 任务来源：用户接受审查建议，要求分三步修改，不提交，全部完成后统一测试。
- 优先级：P1 / P2，S22–S25。
- 范围：弹窗生命周期、日程异步读取、上传与媒体加载、本地缓存、CI 与文档。

### audit / select

- 已读取 AGENTS、UI_RULES、DESIGN_SYSTEM、TASKS_UI、CODEX_UI_LOOP、日志模板和上一轮记录。
- 选择最小任务 S22（Dialog），随后处理 S23（日程读取）、S24（聊天屏幕外渲染）与 S25（上传/缓存/验证说明）。
- 日程、上传、缓存属于业务/权限边界修复，单独按 AGENTS 执行，不作为视觉 polish。
- 保留消息 recipient、RPC 权限、seq/delta 补偿、Push 安全摘要、日程协作和现有上传路径。

### implement

1. Dialog 的遮罩、Escape、替换与卸载返回取消结果；Tab 焦点圈、外部焦点拦截和焦点恢复。日程列表、详情、协作、评论和提醒状态拒绝过期响应，关闭详情会失效未完成读取。
2. 上传使用共用 XHR 入口，设置 120 秒超时、AbortSignal、进度和错误清理，保持现有手动重试；聊天离开/身份切换取消上传。气泡保留 DOM 锚点和组件状态，实际测量高度后启用 content-visibility，屏幕外媒体延后加载；后台暂停语音签名刷新，签名请求最多等待 30 秒。
3. 图片 Cache API 按家庭/成员隔离，全局最多 128 项、64 MiB；淘汰最早存入项，退出/切换身份清理，缓存代次阻止旧下载回填；清理无身份边界的旧 v1 缓存。签名缓存最多 256 项，同一权限上下文的并发签名共享请求。CI 增加 build，README 与 AGENTS 同步身份、媒体和测试现状。

### validate

- 按用户要求，步骤中未运行测试；全部实现完成后统一执行 lint、typecheck、test、build、git diff --check。
- `npm run lint`：通过，无警告或错误。
- `npm run typecheck`：通过。
- `npm run test`：24 个文件、144 项测试全部通过。
- `npm run build`：通过，39 个页面生成完成；包含最终 Dialog 焦点修复。仅提示 Browserslist 数据过旧，未自动更新依赖。
- `git diff --check`：通过。
- 已补回归用例：慢请求覆盖、关闭后响应、上传进度/超时/取消、缓存隔离/退出失效/容量/不可用、签名并发/过期/撤销/超时。
- 本地临时隔离页面使用合成身份与 1000 条真实 ChatMessage 实例：360px / 390px / 430px 均无横向滚动，末尾第 999 条与前段第 10 条能定位；约 10–15 条接近视口的消息激活媒体加载，测量后的消息启用 content-visibility。保留全部 DOM，不宣称完整虚拟列表或量化性能提升。
- Dialog：三档宽度及 520px 压缩高度下边界可见、无横向溢出；Tab / Shift+Tab 焦点圈、Escape、遮罩、替换、卸载均已检查。confirm 返回 false，prompt 返回 null；关闭后焦点返回触发按钮。浏览器检查发现自动聚焦输入框会干扰焦点恢复，已改为打开弹窗前记录触发元素，并重新验证。
- 浏览器 console 无 error。临时路由已删除，本地验证服务已停止。
- 本轮使用隔离页面，没有真实登录操作及手机设备；520px 高度仅模拟键盘占用。真实上传、录音、聊天已读/通知回流、日程协作/私密权限、iOS/Android PWA 软键盘和 Push 仍需手动验证。生产库健康检查未执行，当前无数据库变更。

### review / record

- UX：保留既有气泡、输入栏、长按、媒体预览、播放组件及日程布局。
- Security：不新增 token URL、日志或 Push payload；缓存身份包含 family/member，不包含凭证；保持服务端签名授权。
- API / RPC / migration：服务端接口和数据库契约没有变化，无 migration。
- 风险：旧缓存首次迁移需要重新下载；缓存淘汰后再次查看会重新签名/下载；不支持 content-visibility 的浏览器沿用常规渲染。
- 未提交、推送或部署。

### 修改文件

- 弹窗 / 日程：`components/Dialog.tsx`、`app/schedule/page.tsx`、`lib/latestRequest.ts`、`lib/latestRequest.test.ts`。
- 聊天 / 上传：`app/chat/page.tsx`、`components/ChatMessageViewport.tsx`、`components/ChatMessage.tsx`、`components/MemberAvatarCircle.tsx`、`lib/uploadClient.ts`、`lib/uploadClient.test.ts`、`lib/messageService.ts`、`lib/avatarService.ts`、`lib/errors.ts`、`app/me/page.tsx`。
- 缓存 / 身份：`lib/mediaCacheStore.ts`、`lib/mediaCacheStore.test.ts`、`lib/imageCache.ts`、`lib/imageCache.test.ts`、`lib/mediaClient.ts`、`lib/mediaClient.test.ts`、`lib/authLocal.ts`。
- CI / 文档：`.github/workflows/ci.yml`、`AGENTS.md`、`README.md`、`TASKS_UI.md`、`docs/iteration-log/_latest.md`。

### 后续手动回归

1. 真实登录后，弱网连续切换日程月份/筛选、快速打开再关闭不同详情，核对评论、负责人、提醒和私人日程可见性。
2. 分别上传图片、语音和头像；模拟超时、离开聊天与切换家庭，确认取消、进度及手动重试。长聊天检查图片预览、播放、已读、悄悄话和通知定位。
3. 在 iOS / Android PWA 真机检查软键盘、录音、底部安全区和前后台 Push 回流。若后续发布，仍遵守 Vercel 计费确认与生产系统健康对账规则。

---

## 上轮记录：2026-09-29

## meta

- 日期：2026-09-29。
- 执行者：Codex。
- 任务来源：用户要求点击个人页头像触发头像上传。
- 优先级：P2，S21。
- 范围：调整头像上传触发入口，不改变上传数据流。

## audit / select

沿用 UI 治理与 frontend-design 规范，选择 S21 最小修复。头像本身是更直接的头像更换入口，独立全宽上传按钮会重复表达同一动作并拉长身份卡；删除头像属于不同操作，应继续保留。

## implement

- `app/me/page.tsx`：头像外层改为圆形按钮，点击后触发现有隐藏文件输入；根据当前头像状态提供上传头像或更换头像的 `aria-label` 与 `title`，并保留 disabled 和 focus-visible 状态；移除独立上传/更换头像按钮；有头像时继续显示删除按钮，无头像时隐藏空操作区。
- `TASKS_UI.md` 与本记录：登记任务和影响范围。
- 未修改图片压缩、上传、Storage 路径、成员身份、权限、API、RPC、数据库、Push、Realtime 或 Service Worker。

## validate

本轮未执行命令验证或页面复查。

## review / record

UX：用户直接点击头像即可更换头像，身份卡更紧凑，键盘用户仍能聚焦并触发上传；删除头像入口保持独立，避免误操作。

风险：头像上传入口不再显示常驻文字提示，主要依赖头像可点击的常见交互和 `title`；文件选择后的既有错误处理保持不变。

下一步：如需发布，先执行类型检查并手动检查头像点击、文件取消、删除头像和上传失败流程。本轮未提交、推送或部署。
