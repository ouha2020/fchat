export type HealthStatus = "pass" | "fail" | "warn" | "info";
export type HealthSeverity = "critical" | "warning" | "info";

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  severity: HealthSeverity;
  message?: string;
  impact?: string;
  suggestedFix?: string;
  migrationName?: string;
}

export interface HealthGroup {
  id: string;
  label: string;
  checks: HealthCheck[];
}

export interface HealthReport {
  ok: boolean;
  checkedAt: string;
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    info: number;
  };
  groups: HealthGroup[];
}

interface CatalogTable {
  schema: string;
  name: string;
  rls: boolean;
}

interface CatalogColumn {
  schema: string;
  table: string;
  column: string;
}

interface CatalogFunction {
  schema: string;
  name: string;
  args: string;
}

interface CatalogGrant {
  schema: string;
  name: string;
  grantee: string;
  privilege: string;
}

interface CatalogTablePrivilege {
  schema: string;
  table: string;
  grantee: string;
  privilege: string;
}

interface CatalogPolicy {
  schema: string;
  table: string;
  policy: string;
  roles?: string[] | string | null;
  command: string;
  qual?: string | null;
}

interface CatalogMigration {
  version?: string;
  name: string;
}

interface HealthCatalog {
  tables?: CatalogTable[];
  columns?: CatalogColumn[];
  functions?: CatalogFunction[];
  routineGrants?: CatalogGrant[];
  tablePrivileges?: CatalogTablePrivilege[];
  policies?: CatalogPolicy[];
  realtimeTables?: { schema: string; table: string }[];
  buckets?: { name: string }[];
  supabaseMigrations?: CatalogMigration[];
  appMigrations?: CatalogMigration[];
  catalogWarnings?: string[];
}

interface ExpectedTable {
  name: string;
  severity?: HealthSeverity;
  migrationName?: string;
  impact?: string;
}

interface ExpectedColumn extends ExpectedTable {
  table: string;
  column: string;
}

interface ExpectedFunction extends ExpectedTable {
  argIncludes?: string[];
  publicGrant?: boolean;
}

const REQUIRED_TABLES: ExpectedTable[] = [
  { name: "families" },
  { name: "family_members" },
  { name: "messages" },
  { name: "message_recipients", migrationName: "message_recipients_inbox" },
  { name: "message_realtime_events", migrationName: "directed_message_realtime_events" },
  { name: "important_notifications", migrationName: "important_notifications" },
  {
    name: "important_notification_realtime_events",
    severity: "warning",
    migrationName: "important_notification_realtime_events",
    impact: "重要通知实时刷新可能失效。",
  },
  { name: "push_subscriptions", migrationName: "web_push_notifications" },
  { name: "user_presence", migrationName: "web_push_notifications" },
  { name: "push_delivery_logs", migrationName: "push_delivery_compensation" },
  { name: "pending_family_codes", migrationName: "auth_family_code_flow" },
  { name: "family_code_recovery_attempts", migrationName: "resend_existing_family_code" },
  { name: "family_schedule_items", migrationName: "family_schedule_items" },
  { name: "family_schedule_events", migrationName: "family_schedule_events" },
  { name: "family_schedule_comments", migrationName: "schedule_collaboration" },
  { name: "family_schedule_activity_logs", migrationName: "schedule_collaboration" },
  { name: "family_schedule_reminder_rules", migrationName: "schedule_reminder_experience_closure" },
  { name: "family_schedule_reminder_deliveries", migrationName: "schedule_reminder_deliveries" },
  { name: "app_schema_migrations", migrationName: "app_schema_health" },
];

const REQUIRED_COLUMNS: ExpectedColumn[] = [
  column("messages", "updated_at", "message_delta_sync"),
  column("messages", "push_requested_at", "web_push_notifications"),
  column("messages", "recipient_member_id", "private_whisper_messages"),
  column("messages", "family_seq", "family_seq_sync"),
  column("families", "owner_user_id", "auth_family_code_flow"),
  column("families", "owner_email", "resend_existing_family_code"),
  column("families", "family_code"),
  column("families", "join_enabled"),
  column("families", "is_disabled", "admin_console_mvp"),
  column("family_members", "user_id", "auth_family_code_flow"),
  column("family_members", "member_token_hash"),
  column("family_members", "access_token_hash", "family_code_token_security"),
  column("family_members", "status"),
  column("message_recipients", "member_id", "message_recipients_inbox"),
  column("message_recipients", "delivery_state", "message_delivery_state"),
  column("message_recipients", "read_at", "message_delivery_state"),
  column("message_recipients", "notified_at", "message_delivery_state"),
  column("family_schedule_items", "recurrence_group_id", "schedule_recurrence"),
  column("family_schedule_items", "recurrence_rule", "schedule_recurrence"),
  column("family_schedule_items", "recurrence_index", "schedule_recurrence"),
  column("family_schedule_items", "assignee_response", "schedule_collaboration"),
  column("family_schedule_items", "assignee_responded_at", "schedule_collaboration"),
  column("family_schedule_items", "assignee_response_note", "schedule_collaboration"),
  column("family_schedule_reminder_deliveries", "status", "schedule_reminder_deliveries"),
  column("family_schedule_reminder_deliveries", "attempt_count", "schedule_reminder_deliveries"),
  column("family_schedule_reminder_deliveries", "next_retry_at", "schedule_reminder_deliveries"),
  column("family_schedule_reminder_deliveries", "reminder_kind", "schedule_reminder_experience_closure"),
];

const REQUIRED_FUNCTIONS: ExpectedFunction[] = [
  fn("validate_member", ["p_member_id uuid", "p_member_token text"]),
  fn("send_message", ["p_member_id uuid", "p_member_token text"]),
  fn("list_messages_for_member", ["p_member_id uuid", "p_member_token text"]),
  fn("list_messages_delta", ["p_member_id uuid", "p_member_token text"], "message_delta_sync"),
  fn("list_messages_after_seq", ["p_after_seq bigint"], "family_seq_sync"),
  fn("get_message_for_member", ["p_message_id uuid"]),
  fn("get_messages_by_ids_for_member", ["p_message_ids uuid[]"], "batch_get_messages_by_ids"),
  fn("delete_message", ["p_message_id uuid"]),
  fn("mark_messages_delivered", ["p_message_ids uuid[]"], "message_delivery_state"),
  fn("mark_messages_read", ["p_message_ids uuid[]"], "message_delivery_state"),
  fn("get_unread_count_for_member", ["p_member_id uuid"], "message_delivery_state"),
  fn("list_important_notifications_for_member", ["p_member_id uuid"]),
  fn("add_important_notification", ["p_message_id uuid"]),
  fn("create_family_with_verified_code", ["p_user_id uuid"], "auth_family_code_flow", false),
  fn("issue_member_session_for_user", ["p_user_id uuid"], "auth_family_code_flow", false),
  fn("join_family", ["p_family_code text"], undefined, true),
  fn("resolve_join_family_state", ["p_family_code text"]),
  fn("verify_pending_family_code", ["p_user_id uuid"], "auth_family_code_flow", false),
  fn("list_schedule_items_for_member", ["p_range_start timestamp with time zone"], "family_schedule_items"),
  fn("search_schedule_items_for_member", ["p_query text"], "schedule_search_filters"),
  fn("get_schedule_item_for_member", ["p_item_id uuid"], "schedule_details_editing"),
  fn("create_schedule_item", ["p_recurrence_rule text"], "schedule_recurrence"),
  fn("update_schedule_item", ["p_recurrence_scope text"], "schedule_details_editing"),
  fn("replace_schedule_item_recurrence", ["p_recurrence_rule text"], "schedule_recurrence_editing"),
  fn("delete_schedule_item", ["p_recurrence_scope text"], "schedule_details_editing"),
  fn("set_schedule_item_status", ["p_status text"], "family_schedule_items"),
  fn("get_schedule_collaboration_for_member", ["p_schedule_item_id uuid"], "schedule_collaboration"),
  fn("add_schedule_comment", ["p_content text"], "schedule_collaboration"),
  fn("delete_schedule_comment", ["p_comment_id uuid"], "schedule_collaboration"),
  fn("respond_schedule_assignment", ["p_response text"], "schedule_collaboration"),
  fn("set_schedule_reminder_rules", ["p_offsets integer[]"], "schedule_reminder_experience_closure"),
  fn("get_schedule_reminder_status_for_member", ["p_schedule_item_id uuid"], "schedule_reminder_deliveries"),
  fn("snooze_schedule_reminder", ["p_delivery_id uuid"], "schedule_reminder_experience_closure"),
  fn("ensure_overdue_schedule_reminders", [], "schedule_reminder_experience_closure", false),
  fn("get_schedule_reminder_health_for_member", ["p_member_id uuid"], "schedule_reminder_experience_closure"),
  fn("schema_health_ping", [], "app_schema_health", false),
  fn("get_system_health_catalog", [], "app_schema_health", false),
];

const REQUIRED_REALTIME_TABLES = [
  { name: "message_realtime_events", migrationName: "directed_message_realtime_events" },
  { name: "family_schedule_events", migrationName: "family_schedule_events" },
  { name: "family_members", migrationName: "add_family_members_to_realtime" },
  {
    name: "important_notification_realtime_events",
    migrationName: "important_notification_realtime_events",
    optional: true,
  },
];

const REQUIRED_BUCKETS = ["chat-images", "chat-audios"];

const MESSAGE_PRIVACY_TABLES = ["messages", "important_notifications", "message_recipients"] as const;
const MESSAGE_PRIVACY_ROLES = ["anon", "authenticated"] as const;

const REQUIRED_MIGRATIONS = [
  "message_delta_sync",
  "private_whisper_messages",
  "message_recipients_inbox",
  "directed_message_realtime_events",
  "family_seq_sync",
  "message_delivery_state",
  "push_delivery_compensation",
  "family_schedule_items",
  "schedule_recurrence",
  "schedule_details_editing",
  "schedule_collaboration",
  "schedule_reminder_deliveries",
  "schedule_reminder_experience_closure",
  "schedule_recurrence_editing",
  "app_schema_health",
  "message_visibility_privacy_hardening",
];

function column(table: string, columnName: string, migrationName?: string): ExpectedColumn {
  return { table, column: columnName, name: `${table}.${columnName}`, migrationName };
}

function fn(
  name: string,
  argIncludes: string[] = [],
  migrationName?: string,
  publicGrant = true,
): ExpectedFunction {
  return { name, argIncludes, migrationName, publicGrant };
}

export function buildSystemHealthReport(
  catalog: HealthCatalog,
  schemaCacheError?: string | null,
): HealthReport {
  const tableSet = new Set((catalog.tables ?? []).map((table) => `${table.schema}.${table.name}`));
  const columnSet = new Set(
    (catalog.columns ?? []).map((columnInfo) => `${columnInfo.schema}.${columnInfo.table}.${columnInfo.column}`),
  );
  const functions = catalog.functions ?? [];
  const grantSet = new Set(
    (catalog.routineGrants ?? []).map(
      (grant) => `${grant.schema}.${grant.name}.${grant.grantee}.${grant.privilege}`.toLowerCase(),
    ),
  );
  const tablePrivileges = catalog.tablePrivileges ?? [];
  const policies = catalog.policies ?? [];
  const hasTablePrivilegeCatalog = Array.isArray(catalog.tablePrivileges);
  const hasPolicyCatalog = Array.isArray(catalog.policies);
  const realtimeSet = new Set(
    (catalog.realtimeTables ?? []).map((table) => `${table.schema}.${table.table}`),
  );
  const bucketSet = new Set((catalog.buckets ?? []).map((bucket) => bucket.name));
  const migrationSet = new Set(
    [...(catalog.supabaseMigrations ?? []), ...(catalog.appMigrations ?? [])].map((migration) =>
      migration.name.toLowerCase(),
    ),
  );

  const groups: HealthGroup[] = [
    {
      id: "tables",
      label: "数据表",
      checks: REQUIRED_TABLES.map((table) => {
        const exists = tableSet.has(`public.${table.name}`);
        return check({
          id: `table:${table.name}`,
          label: `${table.name} 表`,
          passed: exists,
          severity: table.severity ?? "critical",
          message: "生产库缺少必要数据表。",
          impact: table.impact ?? "相关功能可能直接不可用。",
          suggestedFix: migrationFix(table.migrationName),
          migrationName: table.migrationName,
        });
      }),
    },
    {
      id: "columns",
      label: "字段",
      checks: REQUIRED_COLUMNS.map((expected) =>
        check({
          id: `column:${expected.table}.${expected.column}`,
          label: `${expected.table}.${expected.column}`,
          passed: columnSet.has(`public.${expected.table}.${expected.column}`),
          severity: "critical",
          message: "生产库缺少必要字段。",
          impact: "前端或 RPC 读写该字段时会失败，功能可能没有反应。",
          suggestedFix: migrationFix(expected.migrationName),
          migrationName: expected.migrationName,
        }),
      ),
    },
    {
      id: "rpc",
      label: "RPC / 函数",
      checks: REQUIRED_FUNCTIONS.flatMap((expectedFunction) => {
        const matches = functions.filter(
          (func) => func.schema === "public" && func.name === expectedFunction.name,
        );
        const signatureMatches =
          expectedFunction.argIncludes?.length === 0 ||
          matches.some((func) =>
            expectedFunction.argIncludes?.every((part) =>
              normalizeArgs(func.args).includes(normalizeArgs(part)),
            ),
          );
        const base = check({
          id: `rpc:${expectedFunction.name}`,
          label: `${expectedFunction.name}()`,
          passed: matches.length > 0 && Boolean(signatureMatches),
          severity: "critical",
          message:
            matches.length === 0
              ? "生产库缺少该 RPC。"
              : "生产库 RPC 参数签名和代码调用不一致。",
          impact: rpcImpact(expectedFunction.name),
          suggestedFix: migrationFix(expectedFunction.migrationName),
          migrationName: expectedFunction.migrationName,
        });

        if (!expectedFunction.publicGrant) return [base];
        const anonGrant = grantSet.has(`public.${expectedFunction.name}.anon.execute`);
        const authGrant = grantSet.has(`public.${expectedFunction.name}.authenticated.execute`);
        return [
          base,
          check({
            id: `grant:${expectedFunction.name}`,
            label: `${expectedFunction.name} execute grant`,
            passed: anonGrant || authGrant,
            severity: "warning",
            message: "没有检测到 anon/authenticated 的 execute grant。",
            impact: "前端调用该 RPC 可能被拒绝。",
            suggestedFix: `检查并执行 grant execute on function ${expectedFunction.name}(...) to anon, authenticated;`,
            migrationName: expectedFunction.migrationName,
          }),
        ];
      }),
    },
    {
      id: "realtime",
      label: "Realtime",
      checks: REQUIRED_REALTIME_TABLES.map((expected) => {
        const tableExists = tableSet.has(`public.${expected.name}`);
        const enabled = realtimeSet.has(`public.${expected.name}`);
        if (expected.optional && !tableExists) {
          return {
            id: `realtime:${expected.name}`,
            label: `${expected.name} publication`,
            status: "info",
            severity: "info",
            message: "当前 schema 未声明该表，跳过强制检查。",
          };
        }
        return check({
          id: `realtime:${expected.name}`,
          label: `${expected.name} publication`,
          passed: enabled,
          severity: expected.optional ? "warning" : "critical",
          message: "该表没有加入 supabase_realtime publication。",
          impact: "相关实时同步可能失效，只能依赖轮询或刷新。",
          suggestedFix: `执行 alter publication supabase_realtime add table ${expected.name};`,
          migrationName: expected.migrationName,
        });
      }),
    },
    {
      id: "message-privacy",
      label: "消息隐私边界",
      checks: [
        check({
          id: "message-privacy:catalog:table-privileges",
          label: "table_privileges catalog",
          passed: hasTablePrivilegeCatalog,
          severity: "critical",
          message: "system health catalog 未返回 tablePrivileges。",
          impact: "无法判断生产库是否对消息隐私表开放了直接 SELECT。",
          suggestedFix: migrationFix("message_visibility_privacy_hardening"),
          migrationName: "message_visibility_privacy_hardening",
        }),
        check({
          id: "message-privacy:catalog:policies",
          label: "pg_policies catalog",
          passed: hasPolicyCatalog,
          severity: "critical",
          message: "system health catalog 未返回 policies。",
          impact: "无法判断生产库是否残留 using (true) 的消息隐私策略。",
          suggestedFix: migrationFix("message_visibility_privacy_hardening"),
          migrationName: "message_visibility_privacy_hardening",
        }),
        ...MESSAGE_PRIVACY_TABLES.map((table) => {
          const riskyGrants = tablePrivileges.filter(
            (privilege) =>
              privilege.schema === "public" &&
              privilege.table === table &&
              MESSAGE_PRIVACY_ROLES.includes(privilege.grantee as (typeof MESSAGE_PRIVACY_ROLES)[number]) &&
              privilege.privilege.toLowerCase() === "select",
          );
          return check({
            id: `message-privacy:grant:${table}`,
            label: `${table} 直接读取权限`,
            passed: riskyGrants.length === 0,
            severity: "critical",
            message: "检测到 anon/authenticated 可直接 SELECT 消息隐私表。",
            impact: "可能绕过 RPC 与 message_recipients 可见性过滤，造成消息或重要通知隐私泄露。",
            suggestedFix: `执行 revoke all on ${table} from anon, authenticated; 并确认只通过 RPC 读取。`,
            migrationName: "message_visibility_privacy_hardening",
          });
        }),
        ...MESSAGE_PRIVACY_TABLES.map((table) => {
          const permissivePolicies = policies.filter(
            (policy) =>
              policy.schema === "public" &&
              policy.table === table &&
              policy.command.toUpperCase() === "SELECT" &&
              policyRolesIntersect(policy.roles, MESSAGE_PRIVACY_ROLES) &&
              isTruePolicyQual(policy.qual),
          );
          return check({
            id: `message-privacy:policy:${table}`,
            label: `${table} SELECT policy`,
            passed: permissivePolicies.length === 0,
            severity: "critical",
            message: "检测到 using (true) 的消息隐私表 SELECT policy。",
            impact: "即使撤销 direct grant 后，未来重新 grant 时也可能立刻暴露消息数据。",
            suggestedFix: `删除 ${table} 的 using (true) 策略，并创建 using (false) 的 RPC-only 策略。`,
            migrationName: "message_visibility_privacy_hardening",
          });
        }),
        ...["list_messages_for_member", "list_messages_delta", "list_messages_after_seq", "get_message_for_member", "get_messages_by_ids_for_member", "list_important_notifications_for_member"].map((rpcName) => {
          const exists = functions.some((func) => func.schema === "public" && func.name === rpcName);
          return check({
            id: `message-privacy:rpc:${rpcName}`,
            label: `${rpcName}() 可见性 RPC`,
            passed: exists,
            severity: "critical",
            message: "缺少消息读取可见性 RPC。",
            impact: "前端可能无法通过受控 RPC 读取消息，或被迫回退到不安全直读路径。",
            suggestedFix: migrationFix(
              rpcName === "list_messages_after_seq" ? "family_seq_sync" : "message_recipients_inbox",
            ),
            migrationName: rpcName === "list_messages_after_seq" ? "family_seq_sync" : "message_recipients_inbox",
          });
        }),
      ],
    },
    {
      id: "rls",
      label: "RLS / 权限",
      checks: REQUIRED_TABLES.filter((table) => table.name !== "app_schema_migrations").map((expected) => {
        const table = (catalog.tables ?? []).find(
          (candidate) => candidate.schema === "public" && candidate.name === expected.name,
        );
        return check({
          id: `rls:${expected.name}`,
          label: `${expected.name} RLS`,
          passed: table ? table.rls : false,
          severity: "warning",
          message: table ? "该表未启用 RLS。" : "无法检查 RLS，表不存在。",
          impact: "权限边界可能不符合当前设计。",
          suggestedFix: `检查 ${expected.name} 的 RLS 和策略。`,
          migrationName: expected.migrationName,
        });
      }),
    },
    {
      id: "storage",
      label: "Storage",
      checks: REQUIRED_BUCKETS.map((bucket) =>
        check({
          id: `bucket:${bucket}`,
          label: `${bucket} bucket`,
          passed: bucketSet.has(bucket),
          severity: "critical",
          message: "生产库缺少 Storage bucket。",
          impact: bucket === "chat-images" ? "图片上传可能失败。" : "语音上传可能失败。",
          suggestedFix: `在 Supabase Storage 创建 ${bucket} bucket 并配置现有策略。`,
        }),
      ),
    },
    {
      id: "migrations",
      label: "Migrations",
      checks: [
        ...REQUIRED_MIGRATIONS.map((migrationName) =>
          check({
            id: `migration:${migrationName}`,
            label: migrationName,
            passed: migrationSet.has(migrationName.toLowerCase()),
            severity: "warning",
            message: "没有在 migration 历史或 app_schema_migrations 中检测到该记录。",
            impact: "如果实际 schema 也缺失，对应线上功能可能不可用。",
            suggestedFix: migrationFix(migrationName),
            migrationName,
          }),
        ),
        ...(catalog.catalogWarnings ?? []).map((warning) => ({
          id: `catalog-warning:${warning}`,
          label: warning,
          status: "warn" as const,
          severity: "warning" as const,
          message: "部分 catalog 信息读取失败。",
          impact: "健康检查可能不完整。",
        })),
      ],
    },
    {
      id: "schema-cache",
      label: "Schema Cache",
      checks: [
        schemaCacheError
          ? {
              id: "schema-cache:ping",
              label: "schema_health_ping()",
              status: "warn" as const,
              severity: "warning" as const,
              message: "pg_proc 可能已有函数，但 PostgREST schema cache 暂时不可见。",
              impact: "前端 RPC 可能报 Could not find the function in the schema cache。",
              suggestedFix: "等待 Supabase schema cache 刷新，或在 Supabase 后台触发 schema reload。",
            }
          : {
              id: "schema-cache:ping",
              label: "schema_health_ping()",
              status: "pass" as const,
              severity: "info" as const,
            },
      ],
    },
  ];

  const allChecks = groups.flatMap((group) => group.checks);
  const failed = allChecks.filter((item) => item.status === "fail").length;
  const warnings = allChecks.filter((item) => item.status === "warn").length;
  const info = allChecks.filter((item) => item.status === "info").length;
  const passed = allChecks.filter((item) => item.status === "pass").length;
  return {
    ok: failed === 0,
    checkedAt: new Date().toISOString(),
    summary: { passed, failed, warnings, info },
    groups,
  };
}

function check(input: {
  id: string;
  label: string;
  passed: boolean;
  severity: HealthSeverity;
  message?: string;
  impact?: string;
  suggestedFix?: string;
  migrationName?: string;
}): HealthCheck {
  return {
    id: input.id,
    label: input.label,
    status: input.passed ? "pass" : input.severity === "critical" ? "fail" : "warn",
    severity: input.severity,
    message: input.passed ? undefined : input.message,
    impact: input.passed ? undefined : input.impact,
    suggestedFix: input.passed ? undefined : input.suggestedFix,
    migrationName: input.migrationName,
  };
}

function migrationFix(migrationName?: string): string | undefined {
  return migrationName ? `执行或补齐 migration: ${migrationName}` : undefined;
}

function normalizeArgs(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isTruePolicyQual(value?: string | null): boolean {
  const normalized = (value ?? "").toLowerCase().replace(/\s+/g, "");
  return normalized === "true" || normalized === "(true)";
}

function policyRolesIntersect(
  roles: string[] | string | null | undefined,
  expectedRoles: readonly string[],
): boolean {
  if (!roles) return false;
  if (Array.isArray(roles)) {
    return roles.some((role) => expectedRoles.includes(role.toLowerCase()));
  }
  const normalized = roles
    .replace(/[{}"]/g, "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
  return normalized.some((role) => expectedRoles.includes(role));
}

function rpcImpact(name: string): string {
  if (name.includes("schedule")) return "日程相关功能可能不可用或保存后没有反应。";
  if (name.includes("message") || name === "send_message") return "聊天消息同步、发送或权限过滤可能失效。";
  if (name.includes("important")) return "重要通知可能无法显示或写入。";
  if (name.includes("family") || name.includes("member")) return "家庭创建、加入或身份恢复可能失败。";
  return "相关线上功能可能不可用。";
}
