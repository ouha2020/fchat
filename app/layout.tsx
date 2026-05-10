import type { Metadata, Viewport } from "next";
import "./globals.css";
import LanguageProvider from "@/components/LanguageProvider";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

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
          <LanguageProvider>{children}</LanguageProvider>
        </div>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
