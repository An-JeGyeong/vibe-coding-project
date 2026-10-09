"use client";

import type { ReactNode } from "react";
import { RoleGate } from "./RoleGate";

export function OperatorGate({ children }: { children: ReactNode }) {
  return <RoleGate roles={["OPERATOR"]} deniedMessage="회차·원문 관리는 운영자만 사용할 수 있습니다.">{children}</RoleGate>;
}

export function ReviewerGate({ children }: { children: ReactNode }) {
  return <RoleGate roles={["REVIEWER"]} deniedMessage="검수는 감수자만 사용할 수 있습니다.">{children}</RoleGate>;
}

export function TypesetterGate({ children }: { children: ReactNode }) {
  return <RoleGate roles={["TYPESETTER"]} deniedMessage="식자 작업은 식자만 사용할 수 있습니다.">{children}</RoleGate>;
}

export function AssigneeGate({ children }: { children: ReactNode }) {
  return <RoleGate roles={["TRANSLATOR", "REVIEWER"]} deniedMessage="배정된 회차는 번역가·감수자만 사용할 수 있습니다.">{children}</RoleGate>;
}
