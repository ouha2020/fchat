import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "家人聊天室",
  description: "无需注册，输入家庭代码即可和家人实时聊天。",
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
          {children}
        </div>
      </body>
    </html>
  );
}
