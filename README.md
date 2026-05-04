# 家人聊天室 / Family Chat

一个不需要注册的家庭即时聊天网页应用。家人打开网址、输入家庭代码、选择角色，就能进入家庭聊天室收发消息、图片和位置。

> 技术栈：Next.js 14 (App Router) · React · TypeScript · Tailwind CSS · Supabase (Postgres + Realtime + Storage)

## 功能

- 创建家庭，自动生成 6 位家庭代码
- 输入家庭代码 + 昵称 + 角色（爸爸 / 妈妈 / 孩子）即可加入
- `member_token` 保存在浏览器 `localStorage`，下次打开自动进入
- 家庭群聊：文字 / 图片 / 位置 / 系统消息
- Supabase Realtime 实时同步
- 图片上传到 Supabase Storage
- 浏览器 `navigator.geolocation` 发送当前位置（发送前确认）
- 成员列表，管理员可移除成员
- 管理员可：修改家庭名称、重置家庭代码、开关新成员加入

## 本地启动

1. 安装依赖

   ```bash
   npm install
   ```

2. 准备 Supabase

   - 在 [supabase.com](https://supabase.com) 新建一个项目
   - 打开 SQL 编辑器，执行 [`supabase/schema.sql`](./supabase/schema.sql) 全文（包含表、RLS、RPC、Realtime 发布、Storage Bucket）
   - 在「Project Settings → API」复制 `URL` 与 `anon public` key

3. 配置环境变量

   ```bash
   cp .env.local.example .env.local
   ```

   填入：

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxxxx
   ```

4. 启动

   ```bash
   npm run dev
   ```

   打开 <http://localhost:3000>。

## 部署

推荐 Vercel：

1. 将该仓库导入 Vercel
2. 添加上面两个环境变量
3. 一键部署

## 安全说明

- 家庭代码 + 昵称即可加入，由管理员通过「关闭新成员加入」/「重置家庭代码」控制风险
- 所有写操作都通过 Postgres `SECURITY DEFINER` RPC 进行，并校验 `member_token`
- `families.admin_password_hash` 通过 `families_public` 视图屏蔽，前端不可见
- 消息读取通过 RLS 允许 anon 直接 SELECT（仅按 `family_id` 过滤），适合 MVP；如需更严格隔离，可改造为基于自签 JWT 的方案

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
