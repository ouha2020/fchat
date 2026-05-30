import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppPresenceTracker from "@/components/AppPresenceTracker";
import DialogProvider from "@/components/Dialog";
import LanguageProvider from "@/components/LanguageProvider";
import ScheduleReminderNotifier from "@/components/ScheduleReminderNotifier";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import ToastProvider from "@/components/Toast";

export const metadata: Metadata = {
  title: "Family Chat",
  description: "A private realtime chat for families.",
  applicationName: "Family Chat",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Family Chat",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#4f6cf7",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-slate-50">
          <LanguageProvider>
            <ToastProvider>
              <DialogProvider>
                {children}
                <ScheduleReminderNotifier />
              </DialogProvider>
            </ToastProvider>
          </LanguageProvider>
        </div>
        <AppPresenceTracker />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
