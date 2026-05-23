import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-6 py-12 text-center">
      <div className="section-card w-full max-w-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">
          !
        </div>
        <h1 className="text-xl font-bold text-slate-900">当前处于离线状态</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          网络恢复后，聊天和日程会继续同步。你也可以稍后返回首页重新进入。
        </p>
        <Link href="/" className="btn-primary mt-5 w-full">
          返回首页
        </Link>
      </div>
    </main>
  );
}
