# 商用首版验收台账

日期：2026-10-05。范围：允许邀请家庭正式使用的移动优先 Web/PWA 首版。
状态：本地统一验收及生产数据库撤权/权限对账完成，当前为商用候选版。用户已明确授权本次提交、push、PR 合并及其 Vercel 自动部署/计费影响；正在执行发布。部署配置、实网、真机、备份恢复仍未验收，代码发布不代表商用准入完成。

## 本轮修复与验证边界

| 项目 | 实现 | 验收状态 |
| --- | --- | --- |
| 首页/加入/相册/成员/设置/个人/日程旧身份恢复 | 每个异步响应核对发起时身份和共享版本，网络错误不清除有效会话 | 本地单元与浏览器通过 |
| 已打开家庭内容与图片预览 | 共享身份失效时立即卸载私有页面及弹窗，不删除替换后的会话 | 本地身份与双标签页浏览器通过 |
| 图片与签名缓存 | v3 随机会话版本键、容量限制、旧下载拒绝、保留新版本清理、无存储时不持久化 | 单元与原生 Cache API 通过；首次重建须联网 |
| Push 诊断 | POST JSON，member token 不进入 URL；身份和 family/member 过滤仍在服务端，响应 no-store | 真实路由与客户端单元通过，实网待验 |
| API 请求体 | 读取过程中限制字节数，拒绝错误 UTF-8、非法 JSON 与超限流；Auth API 同步使用 | 流式请求单元通过 |
| 首版邀请注册 | 服务端 `FAMILY_REGISTRATION_ALLOWED_EMAILS` 精确邮箱名单；空名单关闭新创建者；家庭代码加入保持 | 推荐方案按默认假设实现，待环境配置 |
| Auth 公共注册入口 | 2026-10-05 真实只读 GET `/auth/v1/settings` | **未通过：disable_signup=false**；管理台当前需要登录，生产配置未修改 |
| 新创建者绕过入口 | family-code/create-family 同样检查邀请；旧匿名 create_family 两签名撤权 | 生产 migration、权限与健康对账通过 |
| 邮件重发/找回 | 60 秒冷却、既有时间戳原子认领、数据库限流失败停止发送；配额已满不继续增加记录；日志不记录服务商正文 | 并发路由单元通过，实网邮件待验 |
| 安全维护版本 | Next.js 16.3.8、React 19.3.0；保留 Webpack，ESLint CLI、独立 typegen，CI Node 22 | lint/typecheck/unit/browser/build 通过；生产 audit 0 |
| 发送后阅读历史 | 离开底部使旧动画帧/延迟跟随失效；尺寸回调执行前复核当前位置与请求版本 | 修复前确定性失败，修复后原场景/新增用例各重复 3 次通过 |

本轮 API/RPC 影响：`/api/push/diagnostics` 从 GET 改 POST，旧 GET 返回 405；不提供把 token 放回 URL 的兼容回退。前后端必须一起更新。Auth API 的错误 JSON/类型/超限请求现在返回 400/415/413；未邀请的新创建者返回 403，邮件重发冷却返回 429。

不变的安全来源：所有家庭内容仍由 active 成员、member token、family membership、recipient 和授权 RPC/API 判定。共享缓存版本不能代替服务器授权；短期签名 URL 在过期前仍可被持有者使用。

## 数据库与环境门槛

1. 已同步 canonical schema 并在已核对的 fchat 生产项目应用 `supabase/migrations/20261005_revoke_legacy_family_creation.sql`。只撤销历史 4/5 参数 `create_family` 的 PUBLIC/anon/authenticated execute 并登记版本，不变更现代 owner RPC、表结构、RLS、消息和日程。应用前已确认旧签名不存在或不可由客户端执行，没有关闭正在使用的入口。
2. 生产 metadata 复核 migration 存在、旧权限关闭、现代 owner 创建 anon 拒绝/service_role 允许、两媒体 bucket private。当前代码读取健康 catalog 后，数据库范围 262 项通过、0 失败、0 警告；排除需要部署环境验证的 secrets。移除当前代码不再调用的历史 `verify_pending_family_code` 健康要求，未恢复旧 RPC。实际 anon 权限脚本 18 项通过，所有合成家庭/成员/消息/日程及触发器行完整回滚；未创建 Storage 对象或投递 Push。
3. 前端发布后的完整 `/admin/system-health` 与部署 secrets/cron 仍需验收。2026-10-05 用户已明确确认本次提交、push、PR 合并及 Vercel 自动部署/计费；发布结果以对应 PR、CI 与部署记录为准。后续其他发布仍遵守仓库计费确认规则。
4. 配置邀请邮箱名单、Node 22.13+（或受支持的 24+）、邮件域名、独立 cron secrets 和 VAPID。名单仅为服务端变量，不进 `NEXT_PUBLIC_`、URL、日志、Push。旧家庭的登录、成员加入不要求进入新创建者名单。
5. 邀请制还需在 Supabase Auth 关闭直接公共 signup，并在隔离环境确认服务端 admin.createUser 与既有登录/重设密码可用。2026-10-05 实网公共设置 GET 已实测 `disable_signup=false`、email=true、anonymous_users=false、mailer_autoconfirm=false；这是明确待修复项。管理台当前需登录，connector 无 Auth 设置写入接口，本轮没有改变生产 Auth 配置。单独关闭网站注册入口不能阻止直接调用 Auth。确认 Site URL/redirect URLs 精确匹配正式域名，不保留广泛通配回跳。

官方依据：[Next.js 支持政策](https://nextjs.org/support-policy)、[Next.js 16 迁移](https://nextjs.org/docs/app/guides/upgrading/version-16)、[Supabase Auth 通用配置](https://supabase.com/docs/guides/auth/general-configuration)、[服务器创建用户](https://supabase.com/docs/reference/javascript/auth-admin-createuser)。

## 实网与真机验收

尚未收到隔离测试地址或明确的设备类型。用户已确认有测试资源，待提供完整 URL 和 iOS/Android PWA 范围；不要求发送密码、token 或真实家庭内容。

实网预检已启动：相关 fchat 项目 ACTIVE_HEALTHY，现有隔离分支为 0；仅使用公开 key 查询已核对项目的公共 Auth 设置，未读取账号或家庭内容、创建用户、发邮件或写业务数据。逐项执行、真机和恢复演练记录见 [`commercial-acceptance-runbook.md`](./commercial-acceptance-runbook.md)。

- 使用两个测试家庭、五个合成身份（发送者、悄悄话接收者、无关成员、管理员、跨家庭成员），再移除一个成员。真实 HTTP 签名必须只允许正确 recipient；管理员不得读取别人的悄悄话或私人日程。验证正文、图片、语音、日程评论/音频、头像、相册的读写；精准清理本轮测试对象及触发器数据。
- owner 邀请邮箱注册→收到家庭代码→验证→创建→普通家人加入→退出/重登/被移除。并行重发只产生一次邮件；Provider/数据库故障时错误可理解，不泄漏底层正文。直接 Auth signup、匿名旧 RPC、未邀请 API 必须被拒绝。
- iOS 和 Android 各做前台/后台/锁屏通知、点击消息 mid 和日程 item、已读补偿、404/410 订阅禁用、关闭 Push 和无权限提示。Push payload 与日志不能包含正文、媒体、位置、家庭代码或凭据。补偿 cron 无 secret 拒绝、有 secret 执行，失败不影响消息发送/日程主操作。
- 真机连续输入、软键盘弹出、录音授权等待/取消/发送、切后台、弱网、断网重连、上传中切换身份、双标签页重登。检查 360/390/430px、safe area、抽屉高度与评论发送按钮；压缩浏览器高度不等同真实软键盘。
- 断网重连不漏消息、不重复发送；已加载长历史不缩短；撤回不复活。记录设备/系统/浏览器版本、用例、结果和日期，不记录真实内容或 token。

## 运营与发布准入

| 准入项 | 完成证据 | 当前状态 |
| --- | --- | --- |
| 数据备份与恢复 | 在隔离库实际恢复数据库和 Storage，对账消息/recipient/日程/媒体引用；确认恢复负责人、可接受数据损失和恢复时间。数据库备份不包含 Storage 文件本体，媒体需单独备份/恢复 | 未演练，不能以“有备份”替代；步骤见执行表 |
| 监控与处理 | 健康检查、cron 投递、失败/队列年龄、邮件/Storage 额度；告警送达指定负责人，保留无内容/无凭据的审计摘要 | 待确认，不新建收费资源 |
| 用户支持与数据规则 | 明确支持入口、隐私说明、家庭解散/账号删除/数据导出与保留规则，管理员也受私密权限限制 | 需要运营方确认并验收现有流程 |
| 首批使用 | 先一个受邀测试家庭完成全流程，再按验收结果邀请更多家庭；设定暂停邀请条件与恢复负责人 | 外部验收完成后执行 |
| 发布与回退 | DB 先行→健康对账→确认计费→前端发布；记录旧/新版本。保持撤权和邀请规则，不为回退重新开放匿名创建 | 已获本次发布授权；外部准入仍待验收 |

尚未完成的 P0 准入项必须保留待办。没有实网/真机/恢复证据时，本地全绿仍只能称为商用候选版本。

## 开发依赖与后续

生产依赖 audit 已为 0。开发依赖目前剩 7 项 high，集中于无修复版本的 braces 及其构建工具依赖链；现有 Tailwind/ESLint 只使用仓库受控 glob，不接收用户模式，不在生产请求中运行。保持构建目录、glob 和配置来源可信，开发服务仅本地；不能把运行时 0 写成全部依赖 0。跟踪[上游安全公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)补丁，若改用用户控制的构建模式则必须先处理该风险；不通过强制 Tailwind 4 升级掩盖验证范围。

React Compiler 未开启，本轮 ESLint 保留原有 hooks 顺序/依赖与 Next/a11y 检查；新增 Compiler 诊断单列后续任务，避免安全版本升级夹带全站重构。

回退：仅回退本轮局部补丁并重新安装锁定依赖；不整仓 reset、不删除生产消息。不建议退回存在已知公告的 Next.js 14；故障优先停止新邀请、按审计结果修复受影响路径。媒体 v1/v2 缓存迁移会被丢弃，v3 经授权重建，不影响服务器数据。

## 本地统一验收记录

| 验证 | 最终结果 | 证据范围 |
| --- | --- | --- |
| `npm run lint` | 通过，无错误/警告 | 最终代码与测试 |
| `npm run typecheck` | 通过，生产构建后再次独立通过 | Next typegen 与 TypeScript |
| `npm run test` | 35 文件、216 项全部通过 | API 流式限额、邀请/邮件并发、身份/媒体、原有消息/日程/Push 回归 |
| `npm run test:e2e` | 完整 52 项全部通过，2.4 分钟 | 合成身份/网络、实际页面、原生 IndexedDB/Cache API/MediaRecorder；360/390/430px 与压缩视口 |
| 滚动专项 | 原场景/新增用例各重复 3 次通过；修正测试类型后再次通过 | 修复前已确定性失败，原断言保留，DEBUG 观测已删除 |
| `npm run build` | 通过，生成阶段 38/38 完成 | Next.js 16.3.8 Webpack 本地产物，无部署 |
| 本地生产 HTTP | 8 项通过，服务已退出 | 首页/聊天/日程/离线 200，诊断 GET 405、超限 413，邀请与 Origin 拒绝 403；无真实身份或远端写入 |
| `npm audit --omit=dev` | 0 项漏洞 | 最终锁定生产依赖；完整 audit 的 7 项开发 high 另记录 |
| 差异/新文件检查 | `git diff --check`、未跟踪源码空白/冲突标记检查通过 | 保留已有未提交修改，不改变 Git 换行配置 |
| 生产数据库 | migration 应用；18 项实际 anon 权限及 262 项数据库健康通过 | 合成数据全部回滚；不包含实网 HTTP、部署 secrets 或系统 Push |

测试不产生生产媒体、真实邮件、系统 Push 或隐私截图。3101 浏览器服务与 3102 本地生产服务已回收。S35/S36/S37 的本地及数据库工作完成，S38 的外部准入仍待验收。
