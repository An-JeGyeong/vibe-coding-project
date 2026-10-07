import type { Metadata } from "next";

export const metadata: Metadata = { title: "회차·원문 관리" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
