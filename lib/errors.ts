const ERROR_MAP: Record<string, string> = {
  family_name_required: "请填写家庭名称",
  admin_password_too_short: "管理员密码至少 4 位",
  nickname_required: "请填写昵称",
  invalid_role: "请选择正确的角色",
  family_code_required: "请填写家庭代码",
  family_not_found: "家庭代码不存在",
  join_disabled: "管理员已关闭新成员加入",
  nickname_taken: "该昵称在家庭里已被使用，请换一个",
  unauthorized: "登录已失效，请重新进入家庭",
  not_admin: "仅管理员可操作",
  invalid_admin_password: "管理员密码不正确",
  member_not_found: "成员不存在",
  cannot_remove_self: "不能移除自己",
  invalid_message_type: "不支持的消息类型",
  invalid_effect_id: "不支持的特效",
  message_not_found: "消息不存在",
  cannot_delete_system: "系统消息不能删除",
  not_allowed: "只能删除自己发的消息",
};

export function humanizeError(message: unknown): string {
  if (!message) return "操作失败，请稍后重试";
  const raw =
    typeof message === "string"
      ? message
      : message instanceof Error
        ? message.message
        : String((message as { message?: string }).message ?? message);

  for (const key of Object.keys(ERROR_MAP)) {
    if (raw.includes(key)) return ERROR_MAP[key];
  }
  return raw;
}
