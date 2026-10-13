"use client";

import { SignupForm } from "@/components/SignupForm";

export default function SignupPage() {
  return <main id="main-content" className="container login-main py-5">
    <h1 className="h2 mb-3">회원가입</h1>
    <SignupForm />
  </main>;
}
