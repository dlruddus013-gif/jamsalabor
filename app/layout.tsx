import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "jamsa-vito · 한국잠사박물관 콜센터",
  description: "통화 자동 녹음 · STT · AI 요약 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-cream text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
