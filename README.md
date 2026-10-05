# 家人聊天室 / Family Chat

一个移动端优先的家庭沟通 Web/PWA 应用。创建者使用 Supabase Auth 邮箱账号创建和管理家庭；普通成员通过家庭代码、昵称和角色加入，无需单独注册。

> 技术栈：Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS · Supabase (Postgres + Realtime + Storage)

## 功能

- 创建者通过邮箱账号和家庭代码验证流程创建家庭
- 输入家庭代码 + 昵称 + 角色（爸爸 / 妈妈 / 孩子）即可加入
- `member_token` 保存在浏览器 `localStorage`，下次打开自动进入
- 家庭群聊：文字 / 图片 / 语音 / 位置 / 系统消息，以及发送者与接收者之间的悄悄话
- Supabase Realtime 实时同步
- 图片、语音、头像保存在 Supabase Storage，通过授权 API 获取短期签名 URL
- 家庭日程、重复事项、负责人响应、评论和提醒
- PWA / Web Push：后台使用安全摘要，点击后定位到消息或日程
- 浏览器 `navigator.geolocation` 发送当前位置（发送前确认）
- 成员列表，管理员可移除成员
- 管理员可：修改家庭名称、重置家庭代码、开关新成员加入

## 本地启动

1. 安装依赖

   使用 Node.js 22.13+（22 系列）或 24+；CI 使用 Node 22。

   ```bash
   npm install
   ```

2. 准备 Supabase

   - 在 [supabase.com](https://supabase.com) 新建一个项目
   - 新数据库按 [`supabase/schema.sql`](./supabase/schema.sql) 初始化（包含表、RLS、RPC、Realtime 发布、Storage Bucket）
   - 已有数据库按 `supabase/migrations/` 增量迁移，不用全文 schema 替代生产迁移
   - 从项目 API 设置获取 `URL` 与 publishable key（兼容 legacy anon key）

3. 配置环境变量

   ```bash
   cp .env.local.example .env.local
   ```

   填入：

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=xxxxxx
   ```

   服务端上传与媒体签名需要 `SUPABASE_SERVICE_ROLE_KEY`；邮箱、Push 和定时任务还需要各自服务端配置，详见 [`AGENTS.md`](./AGENTS.md) 与 `.env.local.example`。不要把服务端密钥放入 `NEXT_PUBLIC_` 变量。

   首版采用邀请制创建家庭：在服务端 `FAMILY_REGISTRATION_ALLOWED_EMAILS` 填入获邀创建者邮箱，以逗号、分号或空白分隔；空名单会关闭新创建者注册与创建入口。既有家庭登录与普通成员通过家庭代码加入保持可用。还需核对 Supabase Auth 公共 signup 配置，具体准入与验收状态见 [`商用首版台账`](./docs/commercial-readiness.md)。

4. 启动

   ```bash
   npm run dev
   ```

   打开 <http://localhost:3000>。

## 验证与发布

本地验证：

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
git diff --check
```

CI 执行生产依赖安全审计、类型检查、lint、Vitest、Playwright 浏览器回归和生产构建。浏览器测试安装、合成数据隔离及手动验收步骤见 [`docs/browser-regression.md`](./docs/browser-regression.md)。真实键盘、录音、Push 和 HTTP 媒体权限仍需另行验收；完成证据和剩余准入项见 [`商用首版台账`](./docs/commercial-readiness.md)。

数据库改动先同步 migration 与 schema，在生产应用并通过系统健康检查对账后，再发布前端。`main` 连接 Vercel 自动部署；推送、PR 或合并前须遵守 [`AGENTS.md`](./AGENTS.md) 的部署计费确认规则。

## 安全说明

- 家庭代码 + 昵称即可加入，由管理员通过「关闭新成员加入」/「重置家庭代码」控制风险
- 家庭数据读写通过授权 RPC 或服务端 API，校验 `member_id + member_token`、active 成员状态和家庭归属
- `families.admin_password_hash` 通过 `families_public` 视图屏蔽，前端不可见
- `message_recipients` 决定消息可见性，普通成员和管理员都不能默认读取别人之间的悄悄话；消息表已撤销 anon/authenticated 直接访问权限
- Storage 的私有设置以生产迁移对账为准。签名 URL 过期前仍有效；本地媒体缓存按家庭/成员隔离，最多 128 项、64 MiB，退出或切换身份时清理
- Push 与 Realtime 只传轻量安全信号，消息正文、媒体引用和坐标仍通过授权接口读取

## 目录结构

```
app/
  page.tsx              首页：加入家庭
  create-family/page.tsx 创建家庭
  chat/page.tsx         聊天室
  members/page.tsx      成员列表
  settings/page.tsx     家庭设置
components/             ChatInput、ChatMessage、RoleSelect、RoleBadge…
lib/                    Supabase client、authLocal、各 Service
types/                  family / member / message
supabase/schema.sql     数据库 + RLS + RPC + Storage
```
