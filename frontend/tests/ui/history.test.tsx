import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import HistoryPage from "@/app/(auth)/history/page";
import { listHistory } from "@/lib/history/client";
import { describeEvent } from "@/lib/history/labels";
import { HISTORY_EVENTS, type HistoryItem } from "@/lib/history/types";
import type { Role } from "@/lib/auth/types";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, TOKEN, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
  useParams: () => ({}),
}));

const T = "2026-10-07T01:00:00.123456Z";
const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id: String(id), occurredAt: T, event: "SOURCE_SAVED", actor: { id: "1", displayName: "데모 운영자" }, episodeId: "7", episodeTitle: "1화",
  sourceVersion: 2, translationVersionNo: null, subject: null, ...extra,
});

type H = (call: FetchCall) => Response | Promise<Response>;
function server(role: Role, history: H) {
  storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody(role));
    if (call.path === "/api/history") return history(call);
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}
const historyCalls = (calls: FetchCall[]) => calls.filter((call) => call.path === "/api/history");
const search = (call: FetchCall) => new URL(call.url).searchParams;

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); nav.search = ""; });

describe("history client (24.1)", () => {
  test("sends the filters and paging exactly, with the bearer token and no cookies", async () => {
    const { calls } = server("OPERATOR", () => json(200, { items: [row(5)], total: 1 }));
    const result = await listHistory({ episodeId: "7", event: "REVIEW_REJECTED", limit: 20, offset: 40 });
    expect(result).toMatchObject({ ok: true, value: { total: 1, items: [{ id: "5", event: "SOURCE_SAVED", actor: { displayName: "데모 운영자" } }] } });
    const call = historyCalls(calls)[0];
    expect(call.method).toBe("GET");
    expect(Object.fromEntries(search(call))).toEqual({ episodeId: "7", event: "REVIEW_REJECTED", limit: "20", offset: "40" });
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.init.credentials).toBe("omit");
    await listHistory({ limit: 20, offset: 0 });
    expect(Object.fromEntries(search(historyCalls(calls)[1]))).toEqual({ limit: "20", offset: "0" });
  });

  test("keeps only the documented fields; malformed bodies are refused", async () => {
    server("OPERATOR", () => json(200, { items: [row(5, { reason: "비밀 사유", text: "원문", translationVersionId: "99", subject: { id: "2", displayName: "번역가", token: "x" } })], total: 1 }));
    const ok = await listHistory({ limit: 20, offset: 0 });
    expect(ok.ok && Object.keys(ok.value.items[0]).sort()).toEqual(["actor", "episodeId", "episodeTitle", "event", "id", "occurredAt", "sourceVersion", "subject", "translationVersionNo"]);
    expect(ok.ok && ok.value.items[0].subject).toEqual({ id: "2", displayName: "번역가" });
    for (const bad of [{}, { items: [{ id: 5 }], total: 1 }, { items: [row(1, { actor: null })], total: 1 }, { items: [row(1, { sourceVersion: "2" })], total: 1 }, { items: [row(1, { occurredAt: "soon" })], total: 1 }]) {
      server("OPERATOR", () => json(200, bad));
      expect((await listHistory({ limit: 20, offset: 0 })).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test("status mapping and no request without a token", async () => {
    for (const [status, kind] of [[400, "invalid_request"], [403, "forbidden"], [503, "unavailable"], [500, "server_error"]] as const) {
      server("OPERATOR", () => json(status, errorBody("X")));
      expect(await listHistory({ limit: 20, offset: 0 })).toEqual({ ok: false, failure: { kind } });
    }
    window.sessionStorage.clear();
    const { fn } = mockFetch(() => json(200, {}));
    expect(await listHistory({ limit: 20, offset: 0 })).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("event wording (24.3)", () => {
  const base = row(1) as unknown as HistoryItem;
  test("each known event has a fixed Korean sentence with its version or subject; unknown events are generic", () => {
    const at = (event: string, extra: Partial<HistoryItem> = {}) => describeEvent({ ...base, event, ...extra });
    expect(at("EPISODE_CREATED")).toBe("회차 생성");
    expect(at("SOURCE_SAVED", { sourceVersion: 4 })).toBe("원문 저장 (v4)");
    expect(at("SOURCE_SAVED", { sourceVersion: null })).toBe("원문 저장");
    expect(at("ASSIGNED", { subject: { id: "2", displayName: "데모 번역가" } })).toBe("담당자 배정 → 데모 번역가");
    expect(at("ASSIGNED", { subject: null })).toBe("담당자 배정 → 알 수 없음");
    expect(at("TRANSLATION_CREATED", { translationVersionNo: 2 })).toBe("번역 v2 시작");
    expect(at("TRANSLATION_SUBMITTED", { translationVersionNo: 2 })).toBe("번역 v2 제출");
    expect(at("REVIEW_APPROVED", { translationVersionNo: 2 })).toBe("번역 v2 승인");
    expect(at("REVIEW_REJECTED", { translationVersionNo: 2 })).toBe("번역 v2 반려");
    expect(at("APPROVAL_INVALIDATED", { translationVersionNo: 2 })).toBe("번역 v2 승인 무효화");
    expect(at("TRANSLATION_PUBLISHED", { translationVersionNo: 3 })).toBe("번역 v3 발행");
    expect(at("PUBLICATION_HELD", { translationVersionNo: 3 })).toBe("공개 보류 (번역 v3)");
    expect(at("PUBLICATION_RESUMED", { translationVersionNo: 3 })).toBe("공개 재개 (번역 v3)");
    expect(at("REVIEW_REJECTED", { translationVersionNo: null })).toBe("번역 반려");
    expect(at("PAGE_IMAGE_SAVED")).toBe("페이지 이미지 저장");
    expect(at("AI_DRAFT_REQUESTED", { translationVersionNo: 2 })).toBe("AI 초안 요청 (번역 v2)");
    expect(at("SOMETHING_NEW")).toBe("기타 작업");
    expect(HISTORY_EVENTS).toHaveLength(12);
    expect(HISTORY_EVENTS).not.toContain("AI_DRAFT_REQUESTED"); // the API rejects it as a filter (400)
  });
});

describe("history page (operator only)", () => {
  test("shows the rows newest first as returned, with wording, title link, actor and subject, as plain text", async () => {
    server("OPERATOR", () => json(200, { items: [
      row(3, { event: "ASSIGNED", sourceVersion: null, subject: { id: "2", displayName: "데모 번역가" } }),
      row(2, { event: "REVIEW_REJECTED", translationVersionNo: 1, sourceVersion: 2, episodeTitle: "<b>굵게</b> 회차" }),
      row(1, { event: "SOURCE_SAVED" })], total: 3 }));
    const { container } = renderWithAuth(<HistoryPage />);
    const table = within(await screen.findByRole("table"));
    const rows = table.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("담당자 배정 → 데모 번역가")).toBeTruthy();
    expect(within(rows[0]).getAllByText("데모 번역가")).toHaveLength(1);
    expect(within(rows[1]).getByText("번역 v1 반려")).toBeTruthy();
    expect(within(rows[1]).getByRole("link", { name: "<b>굵게</b> 회차" }).getAttribute("href")).toBe("/episodes/7");
    expect(container.querySelector("b")).toBeNull();
    expect(within(rows[2]).getByText("원문 저장 (v2)")).toBeTruthy();
    expect(within(rows[0]).getAllByText("데모 운영자")).toHaveLength(1);
  });

  test("empty history, then a 503 with a retry", async () => {
    let healthy = false;
    server("OPERATOR", () => (healthy ? json(200, { items: [], total: 0 }) : json(503, errorBody("SERVICE_UNAVAILABLE"))));
    renderWithAuth(<HistoryPage />);
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("조건에 맞는 작업 이력이 없습니다.")).toBeTruthy();
  });

  test("filters send the right query and return to the first page; the episode filter is validated locally", async () => {
    const { calls } = server("OPERATOR", (call) => {
      const offset = Number(search(call).get("offset"));
      return json(200, { items: Array.from({ length: 20 }, (_, i) => row(100 - offset - i)), total: 45 });
    });
    renderWithAuth(<HistoryPage />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await waitFor(() => expect(historyCalls(calls).some((call) => search(call).get("offset") === "20")).toBe(true));
    fireEvent.change(screen.getByLabelText("작업 종류"), { target: { value: "REVIEW_APPROVED" } });
    await waitFor(() => expect(historyCalls(calls).at(-1) && Object.fromEntries(search(historyCalls(calls).at(-1)!))).toEqual({ event: "REVIEW_APPROVED", limit: "20", offset: "0" }));
    fireEvent.change(screen.getByLabelText("회차 ID"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(screen.getByText("회차 ID는 숫자여야 합니다.")).toBeTruthy();
    const before = historyCalls(calls).length;
    expect(historyCalls(calls)).toHaveLength(before);
    fireEvent.change(screen.getByLabelText("회차 ID"), { target: { value: " 7 " } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(Object.fromEntries(search(historyCalls(calls).at(-1)!))).toEqual({ episodeId: "7", event: "REVIEW_APPROVED", limit: "20", offset: "0" }));
    expect(screen.queryByText("회차 ID는 숫자여야 합니다.")).toBeNull();
  });

  test("the link from an episode (?episodeId=) starts filtered; an invalid value is ignored", async () => {
    nav.search = "episodeId=7";
    const first = server("OPERATOR", () => json(200, { items: [row(1)], total: 1 }));
    const view = renderWithAuth(<HistoryPage />);
    await screen.findByRole("table");
    expect(search(historyCalls(first.calls)[0]).get("episodeId")).toBe("7");
    expect((screen.getByLabelText("회차 ID") as HTMLInputElement).value).toBe("7");
    view.unmount();
    nav.search = "episodeId=%3Cscript%3E";
    const second = server("OPERATOR", () => json(200, { items: [], total: 0 }));
    renderWithAuth(<HistoryPage />);
    await screen.findByText("조건에 맞는 작업 이력이 없습니다.");
    expect(search(historyCalls(second.calls)[0]).get("episodeId")).toBeNull();
  });

  test("a late response of an earlier filter does not replace the latest one", async () => {
    const slow = deferred<Response>();
    let n = 0;
    server("OPERATOR", (call) => {
      n++;
      if (n === 1) return json(200, { items: [row(1)], total: 1 });
      return search(call).get("event") === "SOURCE_SAVED" ? slow.promise : json(200, { items: [row(9, { event: "PUBLICATION_HELD", translationVersionNo: 1 })], total: 1 });
    });
    renderWithAuth(<HistoryPage />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("작업 종류"), { target: { value: "SOURCE_SAVED" } });
    fireEvent.change(screen.getByLabelText("작업 종류"), { target: { value: "PUBLICATION_HELD" } });
    expect(await screen.findByText("공개 보류 (번역 v1)")).toBeTruthy();
    slow.resolve(json(200, { items: [row(2, { episodeTitle: "늦은 응답" })], total: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText("늦은 응답")).toBeNull();
  });

  test("401 signs out; other roles see a notice and no request is sent", async () => {
    server("OPERATOR", () => json(401, errorBody("AUTH_REQUIRED")));
    const first = renderWithAuth(<HistoryPage />);
    await waitFor(() => expect(storedToken()).toBeNull());
    first.unmount();
    for (const role of ["TRANSLATOR", "REVIEWER", "READER"] as const) {
      const { calls } = server(role, () => json(200, { items: [], total: 0 }));
      const view = renderWithAuth(<HistoryPage />);
      expect(await screen.findByText(/운영자만 사용할 수 있습니다/)).toBeTruthy();
      expect(historyCalls(calls)).toHaveLength(0);
      view.unmount();
    }
  });
});
