import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-6 py-12 text-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">
          !
        </div>
        <h1 className="text-xl font-bold text-slate-900">You are offline</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Family Chat needs a network connection to sync the latest messages.
          Please reconnect and return to the chat.
        </p>
        <Link href="/chat" className="btn-primary mt-5 w-full">
          Back to chat
        </Link>
      </div>
    </main>
  );
}
