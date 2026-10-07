import type { Metadata } from "next";

export const metadata: Metadata = { title: "데모 화면" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
