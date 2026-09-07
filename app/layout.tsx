import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "醒来的时候，他在",
  description: "一个第一人称乙女游戏。每一幕都在你面前现场生成。",
};

export const viewport: Viewport = {
  themeColor: "#17110f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
