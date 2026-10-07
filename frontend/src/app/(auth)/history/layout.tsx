import type { Metadata } from "next";

export const metadata: Metadata = { title: "작업 이력" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
