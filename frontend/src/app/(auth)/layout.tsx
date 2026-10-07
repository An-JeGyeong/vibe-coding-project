import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { AuthProvider } from "@/lib/auth/AuthProvider";

export const metadata: Metadata = { title: "작업 공간" };

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthProvider><AppShell>{children}</AppShell></AuthProvider>;
}
