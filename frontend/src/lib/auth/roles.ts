import type { Role } from "./types";

// Display-only guidance. Permissions are enforced by the server; the UI never grants access.
export const ROLE_INFO: Record<Role, { label: string; summary: string; menus: string[] }> = {
  OPERATOR: {
    label: "운영자",
    summary: "회차·원문 등록과 수정, 번역 배정, 승인본 발행을 담당합니다.",
    menus: ["회차·원문 관리", "작품 관리", "번역·검수 배정", "승인본 발행", "작업 이력 조회"],
  },
  TRANSLATOR: {
    label: "번역가",
    summary: "배정된 회차의 번역을 작성하고 검수에 제출합니다.",
    menus: ["배정된 회차", "배정된 번역 작성", "검수 제출"],
  },
  REVIEWER: {
    label: "감수자",
    summary: "배정된 번역을 승인하거나 반려합니다. 직접 제작에 참여한 버전은 승인·반려할 수 없습니다.",
    menus: ["배정된 회차", "검수 대기 목록", "승인·반려"],
  },
  TYPESETTER: {
    label: "식자",
    summary: "승인된 번역을 읽고, 원본 이미지로 만든 번역본(식자 완료) 이미지를 올립니다. 번역은 고칠 수 없습니다.",
    menus: ["식자 대기 목록", "승인된 번역 확인", "번역본 이미지 업로드"],
  },
  READER: {
    label: "독자",
    summary: "발행된 공개본을 열람합니다.",
    menus: ["공개 회차 읽기"],
  },
};

export const DEMO_ACCOUNTS: ReadonlyArray<{ role: Role; loginId: string }> = [
  { role: "OPERATOR", loginId: "demo.operator" },
  { role: "TRANSLATOR", loginId: "demo.translator" },
  { role: "REVIEWER", loginId: "demo.reviewer" },
  { role: "TYPESETTER", loginId: "demo.typesetter" },
  { role: "READER", loginId: "demo.reader" },
];

// Implemented menus per role. Display-only: a link is shown for a server-confirmed role, the server still enforces access.
export const ROLE_MENU_LINKS: Readonly<Record<Role, Readonly<Record<string, string>>>> = {
  OPERATOR: { "회차·원문 관리": "/episodes", "작품 관리": "/works-admin", "작업 이력 조회": "/history" },
  TRANSLATOR: { "배정된 회차": "/assigned" },
  REVIEWER: { "배정된 회차": "/assigned", "검수 대기 목록": "/reviews" },
  TYPESETTER: { "식자 대기 목록": "/typeset" },
  READER: { "공개 회차 읽기": "/read" },
};
