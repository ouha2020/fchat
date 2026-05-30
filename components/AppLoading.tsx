type AppLoadingTone = "home" | "chat" | "schedule" | "profile" | "settings" | "members";

const toneCopy: Record<AppLoadingTone, string> = {
  home: "家人空间准备中",
  chat: "正在进入家人聊天室",
  schedule: "正在整理家庭日程",
  profile: "正在同步个人页",
  settings: "正在打开设置",
  members: "正在整理成员列表",
};

interface AppLoadingProps {
  message?: string;
  tone?: AppLoadingTone;
}

export default function AppLoading({
  message,
  tone = "home",
}: AppLoadingProps) {
  const displayMessage = message ?? toneCopy[tone];

  return (
    <main
      className="app-loading-screen"
      role="status"
      aria-live="polite"
      aria-label={displayMessage}
    >
      <div className="app-loading-bg" aria-hidden>
        <span className="app-loading-branch app-loading-branch-left" />
        <span className="app-loading-branch app-loading-branch-right" />
      </div>

      <section className="app-loading-panel" aria-hidden>
        <div className="app-loading-mark">
          <svg
            className="h-16 w-16"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M14 30.5 32 14l18 16.5"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M19 29v18.5A2.5 2.5 0 0 0 21.5 50h21A2.5 2.5 0 0 0 45 47.5V29"
              stroke="currentColor"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M32 47V29"
              stroke="#9A6A36"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d="M32 32c-4.5-4.5-8.5-4.5-12-1 4.5 4.5 8.5 4.5 12 1Z"
              fill="#B9D989"
            />
            <path
              d="M32 28c4.5-4.5 8.5-4.5 12-1-4.5 4.5-8.5 4.5-12 1Z"
              fill="#8FBD68"
            />
            <path
              d="M32 24c-2.5-4.5-2-7.5 1.5-10 2.5 4.5 2 7.5-1.5 10Z"
              fill="#D9EAB6"
            />
          </svg>
        </div>

        <div className="mt-5 text-center">
          <p className="text-[28px] font-black tracking-normal text-slate-900">
            HomeTree
          </p>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
            {displayMessage}
          </p>
        </div>

        <div className="mt-8 flex items-end justify-center gap-2" aria-hidden>
          <span className="app-loading-dot" />
          <span className="app-loading-dot" />
          <span className="app-loading-dot" />
        </div>
      </section>

      <span className="sr-only">{displayMessage}</span>
    </main>
  );
}
