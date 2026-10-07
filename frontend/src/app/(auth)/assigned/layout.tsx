import type { Metadata } from "next";

export const metadata: Metadata = { title: "배정된 회차" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
