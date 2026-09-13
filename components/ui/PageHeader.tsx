import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

export default function PageHeader({ title, backLabel, subtitle, action }: {
  title: string; backLabel: string; subtitle?: ReactNode; action?: ReactNode;
}) {
  return (
    <header className="mb-5 flex min-h-11 items-center gap-3">
      <Link href="/chat" className="tool-icon-button !bg-white" aria-label={backLabel}>
        <ArrowLeftIcon className="tool-icon" aria-hidden="true" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="mt-1 break-words text-xs leading-5 text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}
