"use client";

import { useMemo, useState } from "react";

import type { HealthReport, HealthStatus } from "@/lib/admin/systemHealth";

const STATUS_CLASS: Record<HealthStatus, string> = {
  pass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  fail: "bg-red-50 text-red-700 ring-red-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  info: "bg-slate-100 text-slate-600 ring-slate-200",
};

const STATUS_LABEL: Record<HealthStatus, string> = {
  pass: "通过",
  fail: "缺失",
  warn: "警告",
  info: "信息",
};

export default function SystemHealthPage() {
  const [secret, setSecret] = useState("");
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const headline = useMemo(() => {
    if (!report) return "等待检查";
    if (report.summary.failed > 0) return "有关键缺失";
    if (report.summary.warnings > 0) return "有警告";
    return "数据库状态正常";
  }, [report]);

  async function runCheck() {
    const clean = secret.trim();
    if (!clean) {
      setError("请输入平台维护密钥。");
      return;
    }
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/admin/system-health", {
        headers: { Authorization: `Bearer ${clean}` },
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as
        | HealthReport
        | { message?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(
          payload && "message" in payload && payload.message
            ? payload.message
            : "健康检查失败",
        );
      }
      setReport(payload as HealthReport);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "健康检查失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyReport() {
    if (!report) return;
    const text = JSON.stringify(report, null, 2);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="app-page">
      <header className="app-header">
        <div>
          <p className="text-sm font-semibold text-brand-600">平台管理后台</p>
          <h1 className="page-title">数据库健康检查</h1>
          <p className="page-subtitle">
            对账代码库要求和 Supabase 生产库的表、字段、RPC、Realtime、Storage 与 migration。
          </p>
        </div>
      </header>

      <section className="section-card space-y-3">
        <label>
          <span className="label">平台维护密钥</span>
          <input
            className="field"
            type="password"
            value={secret}
            placeholder="SYSTEM_HEALTH_SECRET"
            autoComplete="off"
            onChange={(event) => {
              setSecret(event.target.value);
              if (error) setError(null);
            }}
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn-primary flex-1" disabled={loading} onClick={runCheck}>
            {loading ? "检查中..." : "重新检查"}
          </button>
          <button
            className="btn-ghost flex-1"
            type="button"
            disabled={!report}
            onClick={copyReport}
          >
            {copied ? "已复制" : "复制诊断报告"}
          </button>
        </div>
        {error ? <p className="error-note">{error}</p> : null}
      </section>

      {report ? (
        <>
          <section className="section-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-slate-500">总体状态</p>
                <h2 className="text-2xl font-bold text-slate-950">{headline}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  检查时间：{new Date(report.checkedAt).toLocaleString()}
                </p>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-sm">
                <SummaryPill label="通过" value={report.summary.passed} tone="pass" />
                <SummaryPill label="缺失" value={report.summary.failed} tone="fail" />
                <SummaryPill label="警告" value={report.summary.warnings} tone="warn" />
                <SummaryPill label="信息" value={report.summary.info} tone="info" />
              </div>
            </div>
          </section>

          <div className="space-y-4">
            {report.groups.map((group) => (
              <section key={group.id} className="section-card">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-950">{group.label}</h2>
                  <span className="text-sm text-slate-500">{group.checks.length} 项</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {group.checks.map((check) => (
                    <article key={check.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="break-words text-sm font-semibold text-slate-900">
                            {check.label}
                          </h3>
                          {check.message ? (
                            <p className="mt-1 text-sm text-slate-600">{check.message}</p>
                          ) : null}
                        </div>
                        <StatusBadge status={check.status} />
                      </div>
                      {check.impact || check.suggestedFix ? (
                        <div className="mt-2 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                          {check.impact ? <p>影响：{check.impact}</p> : null}
                          {check.suggestedFix ? (
                            <p className="mt-1">建议：{check.suggestedFix}</p>
                          ) : null}
                          {check.migrationName ? (
                            <p className="mt-1 font-mono text-xs text-slate-400">
                              migration: {check.migrationName}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : (
        <section className="empty-state">
          <h2 className="text-lg font-bold text-slate-900">还没有检查结果</h2>
          <p className="mt-2 text-sm text-slate-500">
            输入平台维护密钥后运行检查。页面不会显示消息正文、token、hash、家庭代码或 Push endpoint。
          </p>
        </section>
      )}
    </main>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: HealthStatus;
}) {
  return (
    <div className={`rounded-2xl px-3 py-2 ring-1 ${STATUS_CLASS[tone]}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: HealthStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
