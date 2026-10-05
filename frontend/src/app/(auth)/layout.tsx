import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth/AuthProvider";

export const metadata: Metadata = { title: "망가브릿지 · 데모 인증" };

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthProvider>{children}</AuthProvider>;
}
