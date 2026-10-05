import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "망가브릿지 · 로컬 상태 확인" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
