import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DashboardCards } from "@/components/DashboardCards";
import TypesetPage from "@/app/(auth)/typeset/page";
import TypesetEpisodePage from "@/app/(auth)/typeset/[id]/page";
import type { Role } from "@/lib/auth/types";
import { getTypesettable, listTypesettable } from "@/lib/typeset/client";
import { errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, TOKEN, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { id: "7" } as Record<string, string> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: nav.replace }), useParams: () => nav.params }));

const T = "2026-10-09T01:00:00.123456Z";
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const file = (bytes: number[], type: string, name = "t.png") => new File([new Uint8Array(bytes)], name, { type });
const imageResponse = () => new Response(new Blob([new Uint8Array(PNG)], { type: "image/png" }), { status: 200, headers: { "Content-Type": "image/png" } });
const meta = (pageNo: number) => ({ pageNo, contentType: "image/png", byteSize: 2048, updatedAt: T });
const version = (versionNo: number, sourceVersion = 3) => ({ versionNo, sourceVersion, decidedAt: T });
const blocks = [
  { seq: 1, pageNo: 1, source: "원문 1", text: "승인된 번역 1" }, { seq: 2, pageNo: 1, source: "원문 2", text: "승인된 번역 2" },
  { seq: 3, pageNo: 2, source: "원문 3", text: "승인된 번역 3" }, { seq: 4, pageNo: null, source: "원문 4", text: "승인된 번역 4" },
];
const episode = { id: "7", title: "1화 낯선 항구", assignedRole: "TYPESETTER", latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "원문" }] } };
const BASE = "/api/my/episodes/7/translations/3/page-images";

let n = 0;
beforeEach(() => {
  nav.push.mockClear(); nav.params = { id: "7" }; n = 0;
  URL.createObjectURL = vi.fn(() => `blob:t-${++n}`);
  URL.revokeObjectURL = vi.fn();
});

type H = (call: FetchCall) => Response | Promise<Response>;
function server(role: Role, routes: Record<string, H> = {}) {
  storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody(role));
    const handler = routes[`${call.method} ${call.path}`];
    if (handler) return handler(call);
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}
const pick = (label: string, f: File) => fireEvent.change(screen.getByLabelText(label), { target: { files: [f] } });

describe("typesetting client (29.5)", () => {
  test("the version list and the read-only blocks use the typesetting paths with the bearer header only", async () => {
    storeToken();
    const { calls } = mockFetch((call) => (call.path.endsWith("/typesetting") ? json(200, { items: [version(3)] }) : json(200, { versionNo: 3, sourceVersion: 3, blocks })));
    expect(await listTypesettable("7")).toEqual({ ok: true, value: [version(3)] });
    const detail = await getTypesettable("7", 3);
    expect(detail.ok && detail.value.blocks).toHaveLength(4);
    expect(calls.map((call) => call.path)).toEqual(["/api/my/episodes/7/typesetting", "/api/my/episodes/7/typesetting/3"]);
    for (const call of calls) { expect(call.method).toBe("GET"); expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`); expect(call.url).not.toContain(TOKEN); }
  });
  test("a malformed answer is rejected", async () => {
    storeToken();
    mockFetch(() => json(200, { items: [{ versionNo: "3" }], blocks: [{ seq: 1 }] }));
    expect((await listTypesettable("7")).ok).toBe(false);
    expect((await getTypesettable("7", 3)).ok).toBe(false);
  });
});

describe("typesetter list", () => {
  function open(items: unknown[], routes: Record<string, H> = {}) {
    const api = server("TYPESETTER", {
      "GET /api/my/episodes": () => json(200, { items, total: items.length }),
      ...routes,
    });
    renderWithAuth(<TypesetPage />);
    return api;
  }
  const mine = (id: string, title: string) => ({ id, title, assignedRole: "TYPESETTER", latestSourceVersion: 3, assignedAt: T, updatedAt: T });

  test("each row says whether there is an approved translation and how many pages already have a translated image", async () => {
    open([mine("7", "1화"), mine("8", "2화"), mine("9", "3화")], {
      "GET /api/my/episodes/7/typesetting": () => json(200, { items: [version(4), version(3)] }),
      "GET /api/my/episodes/7/translations/4/page-images": () => json(200, { items: [meta(1), meta(2)] }),
      "GET /api/my/episodes/8/typesetting": () => json(200, { items: [] }),
      "GET /api/my/episodes/9/typesetting": () => json(503, errorBody("SERVICE_UNAVAILABLE")),
    });
    expect(await screen.findByText("승인된 번역 v4 · 번역본 이미지 2페이지")).toBeTruthy();
    expect(await screen.findByText("승인된 번역 없음")).toBeTruthy();
    expect(await screen.findByText("확인하지 못함")).toBeTruthy();
    expect(screen.getByRole("link", { name: "1화" }).getAttribute("href")).toBe("/typeset/7");
  });

  test("an empty list, a failing list with a retry, and a wrong role", async () => {
    open([]);
    expect(await screen.findByText("배정된 회차가 없습니다.")).toBeTruthy();
  });

  test("a failing list can be retried", async () => {
    let healthy = false;
    open([], { "GET /api/my/episodes": () => (healthy ? json(200, { items: [], total: 0 }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    expect(await screen.findByRole("alert")).toBeTruthy();
    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("배정된 회차가 없습니다.")).toBeTruthy();
  });

  test("a translator cannot use it and no list request is made", async () => {
    const { calls } = server("TRANSLATOR");
    renderWithAuth(<TypesetPage />);
    expect(await screen.findByText(/식자만 사용할 수 있습니다/)).toBeTruthy();
    expect(calls.some((call) => call.path === "/api/my/episodes")).toBe(false);
  });
});

describe("typesetter workspace (29.6)", () => {
  function open(routes: Record<string, H> = {}) {
    const api = server("TYPESETTER", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/typesetting": () => json(200, { items: [version(3)] }),
      "GET /api/my/episodes/7/typesetting/3": () => json(200, { versionNo: 3, sourceVersion: 3, blocks }),
      "GET /api/my/episodes/7/pages": () => json(200, { items: [meta(1), meta(2)] }),
      "GET /api/my/episodes/7/pages/1/image": () => imageResponse(),
      "GET /api/my/episodes/7/pages/2/image": () => imageResponse(),
      [`GET ${BASE}`]: () => json(200, { items: [] }),
      ...routes,
    });
    renderWithAuth(<TypesetEpisodePage />);
    return api;
  }

  test("original image on the left; the approved translation read-only and the upload on the right; no way to edit the translation", async () => {
    const { calls } = open();
    const image = await screen.findByRole("img", { name: "페이지 1 원본 이미지" });
    const left = image.closest(".col-lg-5")!;
    const right = (await screen.findByText("승인된 번역 1")).closest(".col-lg-7")!;
    expect(left.parentElement).toBe(right.parentElement);
    expect(screen.getByText("원문 1")).toBeTruthy();
    expect(screen.getByLabelText("페이지 1 번역본 이미지 올리기")).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /저장|제출|AI/ })).toBeNull();
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(0);
    expect(await screen.findByText("번역본 이미지 0/2 페이지")).toBeTruthy();
  });

  test("a page can be turned; the page without a number has no image area and no upload", async () => {
    open();
    await screen.findByText("승인된 번역 1");
    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(await screen.findByText("승인된 번역 3")).toBeTruthy();
    expect(screen.getByLabelText("페이지 2 번역본 이미지 올리기")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(await screen.findByText("승인된 번역 4")).toBeTruthy();
    expect(screen.queryByLabelText(/번역본 이미지 (올리기|교체)/)).toBeNull();
  });

  test("an upload goes to the approved version's image path, refreshes the list and the progress", async () => {
    let stored = false;
    const { calls } = open({
      [`GET ${BASE}`]: () => json(200, { items: stored ? [meta(1)] : [] }),
      [`GET ${BASE}/1`]: () => imageResponse(),
      [`PUT ${BASE}/1`]: () => { stored = true; return json(201, meta(1)); },
    });
    await screen.findByText("번역본 이미지 0/2 페이지");
    pick("페이지 1 번역본 이미지 올리기", file(PNG, "image/png"));
    expect(await screen.findByText("번역본 이미지를 올렸습니다.")).toBeTruthy();
    expect(await screen.findByText("번역본 이미지 1/2 페이지")).toBeTruthy();
    expect(await screen.findByRole("img", { name: "페이지 1 번역본 이미지" })).toBeTruthy();
    const puts = calls.filter((call) => call.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].path).toBe(`${BASE}/1`);
    expect(puts[0].headers["Content-Type"]).toBe("image/png");
    expect(screen.getByLabelText("페이지 1 번역본 이미지 교체")).toBeTruthy();
  });

  test("a wrong file is refused locally; server refusals show fixed messages", async () => {
    const { calls } = open({ [`PUT ${BASE}/1`]: () => json(409, { error: { code: "STATE_CONFLICT", currentStatus: "PUBLISHED" } }) });
    await screen.findByText("번역본 이미지 0/2 페이지");
    pick("페이지 1 번역본 이미지 올리기", file(PNG, "image/gif", "a.gif"));
    expect(await screen.findByText("PNG, JPEG, WEBP 이미지만 올릴 수 있습니다.")).toBeTruthy();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    pick("페이지 1 번역본 이미지 올리기", file(PNG, "image/png"));
    expect(await screen.findByText(/승인된 번역에만 이미지를 올릴 수 있습니다/)).toBeTruthy();
    expect(storedToken()).not.toBeNull();
  });

  test("several approved versions: the newest is shown first and another can be chosen", async () => {
    const { calls } = open({
      "GET /api/my/episodes/7/typesetting": () => json(200, { items: [version(4, 3), version(3, 3)] }),
      "GET /api/my/episodes/7/typesetting/4": () => json(200, { versionNo: 4, sourceVersion: 3, blocks: [{ seq: 1, pageNo: 1, source: "원문", text: "네 번째 번역" }] }),
      "GET /api/my/episodes/7/translations/4/page-images": () => json(200, { items: [] }),
    });
    expect(await screen.findByText("네 번째 번역")).toBeTruthy();
    expect((screen.getByLabelText("번역 버전") as HTMLSelectElement).value).toBe("4");
    fireEvent.change(screen.getByLabelText("번역 버전"), { target: { value: "3" } });
    expect(await screen.findByText("승인된 번역 1")).toBeTruthy();
    expect(calls.some((call) => call.path === "/api/my/episodes/7/typesetting/3")).toBe(true);
  });

  test("without an approved translation there is a notice and nothing to upload", async () => {
    open({ "GET /api/my/episodes/7/typesetting": () => json(200, { items: [] }) });
    expect(await screen.findByText("승인된 번역이 아직 없습니다. 감수자가 번역을 승인하면 이미지를 올릴 수 있습니다.")).toBeTruthy();
    expect(screen.queryByLabelText(/번역본 이미지/)).toBeNull();
  });

  test("an unassigned episode (404) and an invalid id show a notice with the way back; a failing load can be retried", async () => {
    server("TYPESETTER", { "GET /api/my/episodes/7": () => json(404, errorBody("NOT_FOUND")), "GET /api/my/episodes/7/typesetting": () => json(404, errorBody("NOT_FOUND")) });
    const first = renderWithAuth(<TypesetEpisodePage />);
    expect(await screen.findByText("배정되지 않았거나 존재하지 않는 회차입니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "식자 대기 목록으로" }).getAttribute("href")).toBe("/typeset");
    first.unmount();
    nav.params = { id: "abc" };
    const { calls } = server("TYPESETTER");
    renderWithAuth(<TypesetEpisodePage />);
    expect(await screen.findByText("배정되지 않았거나 존재하지 않는 회차입니다.")).toBeTruthy();
    expect(calls.some((call) => call.path.startsWith("/api/my/episodes/abc"))).toBe(false);
    nav.params = { id: "7" };
  });

  test("a failing load can be retried", async () => {
    let healthy = false;
    open({ "GET /api/my/episodes/7/typesetting": () => (healthy ? json(200, { items: [version(3)] }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    expect(await screen.findByRole("alert")).toBeTruthy();
    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("승인된 번역 1")).toBeTruthy();
  });

  test("a reviewer cannot use the typesetter workspace", async () => {
    const { calls } = server("REVIEWER");
    renderWithAuth(<TypesetEpisodePage />);
    expect(await screen.findByText(/식자만 사용할 수 있습니다/)).toBeTruthy();
    expect(calls.some((call) => call.path.includes("typesetting"))).toBe(false);
  });
});

describe("typesetter dashboard card (29.6)", () => {
  test("counts episodes that still need images, are complete, or wait for an approval; a failing row only shows a note", async () => {
    const mine = (id: string, title: string) => ({ id, title, assignedRole: "TYPESETTER", latestSourceVersion: 3, assignedAt: T, updatedAt: T });
    const twoPages = { versionNo: 3, sourceVersion: 3, blocks: [{ seq: 1, pageNo: 1, source: "a", text: "가" }, { seq: 2, pageNo: 2, source: "b", text: "나" }, { seq: 3, pageNo: null, source: "c", text: "다" }] };
    server("TYPESETTER", {
      "GET /api/my/episodes": () => json(200, { items: [mine("1", "대기"), mine("2", "부족"), mine("3", "완료"), mine("4", "오류")], total: 4 }),
      "GET /api/my/episodes/1/typesetting": () => json(200, { items: [] }),
      "GET /api/my/episodes/2/typesetting": () => json(200, { items: [version(3)] }),
      "GET /api/my/episodes/2/typesetting/3": () => json(200, twoPages),
      "GET /api/my/episodes/2/translations/3/page-images": () => json(200, { items: [meta(1)] }),
      "GET /api/my/episodes/3/typesetting": () => json(200, { items: [version(3)] }),
      "GET /api/my/episodes/3/typesetting/3": () => json(200, twoPages),
      "GET /api/my/episodes/3/translations/3/page-images": () => json(200, { items: [meta(1), meta(2)] }),
      "GET /api/my/episodes/4/typesetting": () => json(503, errorBody("SERVICE_UNAVAILABLE")),
    });
    renderWithAuth(<DashboardCards role="TYPESETTER" />);
    expect(await screen.findByText("이미지 필요 1건 · 완료 1건 · 승인 전 1건")).toBeTruthy();
    expect(screen.getByText("이미지 1페이지 필요")).toBeTruthy();
    expect(screen.getByText("이미지 완료")).toBeTruthy();
    expect(screen.getByText("승인된 번역 없음")).toBeTruthy();
    expect(screen.getByText("불러오지 못함")).toBeTruthy();
    expect(screen.getByRole("link", { name: "부족" }).getAttribute("href")).toBe("/typeset/2");
  });
});
