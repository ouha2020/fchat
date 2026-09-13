# UI Iteration Log — 聊天顶部头像与标题精简

日期：2026-09-13；S12。用户要求删除聊天页顶部的 “Family” 副标题，并让个人入口在头像加载期间显示昵称首字、加载完成后显示真实头像。

## audit / select / implement

使用 `frontend-design`，读取 UI 治理文档、聊天页头部、成员头像来源和现有头像缓存组件。选中 `/chat` 紧凑头部单点调整，不触碰消息、输入栏、Realtime、Push 或权限逻辑。

删除家庭名称上方重复的 “Family” 文案；个人入口始终使用 `MemberAvatarCircle`，不再经过默认人物图标分支。当前成员资料和头像解析期间显示昵称首字，头像解析完成后自动显示真实图片。入口原有 `aria-label`、`title` 和触控区域保持不变。

修改 `app/chat/page.tsx`、`TASKS_UI.md` 与本记录。无 migration、API、RPC、Auth、权限、Push、Service Worker、Realtime 或 Storage 变化；不部署。

## validate / review

本轮按当前协作约束未执行 lint、typecheck、build、git diff check 或浏览器尺寸回归。需后续验证 360px、390px、430px 下家庭名称截断、昵称首字占位和已设置头像的缓存命中与加载状态。

静态 UX/A11y/Security/Architecture review：头部高度、导航顺序和可读名称保持不变；复用现有头像组件与媒体解析链路，没有新增敏感信息展示、前端权限判断或数据请求。

风险：当前成员资料到达前可能短暂显示 `?`；资料到达后会切换为昵称首字或真实头像。下一步完成规定验证并确认实际头像显示符合预期。
