import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import WorksAdminPage from "@/app/(auth)/works-admin/page";
import WorkAdminPage from "@/app/(auth)/works-admin/[id]/page";
import { EpisodeWorkPanel } from "@/components/EpisodeWorkPanel";
import { OperatorGate } from "@/components/OperatorGate";
import type { Role } from "@/lib/auth/types";
import { createWork, getAdminWork, getEpisodeLink, linkEpisode, listAdminWorks, unlinkEpisode, updateWork, uploadWorkCover } from "@/lib/works/client";
import { normalizeWork, validateWork } from "@/lib/works/validation";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, TOKEN, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { id: "7" } as Record<string, string> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: nav.replace }), useParams: () => nav.params }));

const T = "2026-10-09T01:00:00.123456Z";
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const file = (bytes: number[], type: string) => new File([new Uint8Array(bytes)], "c.png", { type });
const item = (id: number, extra: Record<string, unknown> = {}) => ({ id: String(id), title: `작품${id}`, author: `작가${id}`, readingDirection: "RTL", genres: ["액션", "판타지"], isPublic: false, isFeatured: false, isBanner: false,
  hasCover: true, episodeCount: 2, publicEpisodeCount: 1, revision: 3, updatedAt: T, ...extra });
const detail = (extra: Record<string, unknown> = {}) => ({ ...item(7), description: "소개", episodes: [{ episodeId: "11", episodeNo: 1, title: "1화", published: true }, { episodeId: "12", episodeNo: 2, title: "2화", published: false }], ...extra });
const imageResponse = () => new Response(new Blob([new Uint8Array(PNG)], { type: "image/png" }), { status: 200, headers: { "Content-Type": "image/png" } });

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
let n = 0;
beforeEach(() => {
  nav.push.mockClear(); nav.params = { id: "7" }; n = 0;
  URL.createObjectURL = vi.fn(() => `blob:w-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const bodyOf = (call: FetchCall) => JSON.parse(call.body!);

describe("work validation (28.3)", () => {
  const ok = { title: "제목", author: "작가", description: "소개\n줄바꿈", genres: ["액션"] };
  test("accepts valid input and trims on send; genres follow the fixed order", () => {
    expect(validateWork(ok)).toEqual({});
    expect(normalizeWork({ ...ok, title: " 제목 ", author: " 작가 ", description: "", readingDirection: "RTL", genres: ["판타지", "액션"], isPublic: false, isFeatured: false, isBanner: false }))
      .toMatchObject({ title: "제목", author: "작가", genres: ["판타지", "액션"] });
    expect(normalizeWork({ ...ok, readingDirection: "RTL", genres: ["스포츠", "판타지"], isPublic: false, isFeatured: false, isBanner: false }).genres).toEqual(["판타지", "스포츠"]);
  });
  test.each([
    ["blank title", { title: "   " }, "title"], ["title 101", { title: "가".repeat(101) }, "title"], ["blank author", { author: "" }, "author"],
    ["description 2001", { description: "x".repeat(2001) }, "description"], ["control character", { description: "a\u0000b" }, "description"],
    ["no genre", { genres: [] }, "genres"], ["four genres", { genres: ["액션", "판타지", "로맨스", "일상"] }, "genres"], ["duplicate", { genres: ["액션", "액션"] }, "genres"], ["unknown", { genres: ["공포"] }, "genres"],
  ])("rejects %s", (_name, patch, field) => {
    expect(Object.keys(validateWork({ ...ok, ...patch }))).toContain(field);
  });
  test("100 characters and 2000 characters are allowed", () => {
    expect(validateWork({ ...ok, title: "가".repeat(100), description: "x".repeat(2000) })).toEqual({});
  });
});

describe("works admin client (28.3)", () => {
  test("paths, bodies and bearer header; a new work sends only descriptive fields", async () => {
    storeToken();
    const { calls } = mockFetch((call) => {
      if (call.method === "POST") return json(201, { id: "9", revision: 1 });
      if (call.method === "PUT" && call.path === "/api/works/7") return json(200, { revision: 4, changed: true });
      if (call.path === "/api/works") return json(200, { items: [item(1)], total: 1 });
      if (call.path === "/api/works/7") return json(200, detail());
      if (call.path === "/api/episodes/5/work" && call.method === "GET") return json(200, { work: { workId: "7", title: "작품7", episodeNo: 3 } });
      if (call.path === "/api/episodes/5/work" && call.method === "PUT") return json(200, { workId: "7", episodeNo: 3 });
      if (call.path === "/api/episodes/5/work") return new Response(null, { status: 204 });
      return json(404, errorBody("NOT_FOUND"));
    });
    expect((await listAdminWorks(20, 0)).ok).toBe(true);
    const got = await getAdminWork("7");
    expect(got.ok && got.value.episodes[1]).toEqual({ episodeId: "12", episodeNo: 2, title: "2화", published: false });
    const input = { title: "T", author: "A", description: "", readingDirection: "LTR" as const, genres: ["액션"], isPublic: true, isFeatured: true, isBanner: true };
    expect(await createWork(input)).toEqual({ ok: true, value: { id: "9", revision: 1 } });
    expect(bodyOf(calls.find((call) => call.method === "POST")!)).toEqual({ title: "T", author: "A", description: "", readingDirection: "LTR", genres: ["액션"] });
    expect(await updateWork("7", 3, input)).toEqual({ ok: true, value: { revision: 4, changed: true } });
    expect(bodyOf(calls.find((call) => call.method === "PUT")!)).toMatchObject({ expectedRevision: 3, isPublic: true, isBanner: true });
    expect(await getEpisodeLink("5")).toEqual({ ok: true, value: { workId: "7", title: "작품7", episodeNo: 3 } });
    expect((await linkEpisode("5", "7", 3)).ok).toBe(true);
    expect(bodyOf(calls.find((call) => call.path === "/api/episodes/5/work" && call.method === "PUT")!)).toEqual({ workId: "7", episodeNo: 3 });
    expect(await unlinkEpisode("5")).toEqual({ ok: true, value: null });
    for (const call of calls) expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("409 bodies become revision and state conflicts with their reason; other statuses map as usual", async () => {
    storeToken();
    mockFetch((call) => {
      if (call.path === "/api/works/1") return json(409, { error: { code: "REVISION_CONFLICT", message: "x", latestRevision: 8 } });
      if (call.path === "/api/works/2") return json(409, { error: { code: "STATE_CONFLICT", message: "x", reason: "BANNER_LIMIT" } });
      if (call.path === "/api/works/3") return json(400, errorBody("INVALID_REQUEST"));
      if (call.path === "/api/works/4/cover") return json(409, { error: { code: "STATE_CONFLICT", reason: "COVER_REQUIRED" } });
      return json(503, errorBody("SERVICE_UNAVAILABLE"));
    });
    const input = { title: "T", author: "A", description: "", readingDirection: "RTL" as const, genres: ["액션"], isPublic: false, isFeatured: false, isBanner: false };
    expect(await updateWork("1", 1, input)).toEqual({ ok: false, failure: { kind: "revision_conflict", latestRevision: 8 } });
    expect(await updateWork("2", 1, input)).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: "BANNER_LIMIT" } });
    expect(await updateWork("3", 1, input)).toEqual({ ok: false, failure: { kind: "invalid_request" } });
    expect(await uploadWorkCover("4", file(PNG, "image/png"))).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: "COVER_REQUIRED" } });
    expect((await getAdminWork("5")).ok).toBe(false);
  });

  test("cover upload sends the image as the body and tells new from replaced", async () => {
    storeToken();
    const { calls } = mockFetch((call) => (call.path === "/api/works/1/cover" ? json(201, { contentType: "image/png", byteSize: 12, updatedAt: T }) : json(200, { contentType: "image/png", byteSize: 12, updatedAt: T })));
    expect(await uploadWorkCover("1", file(PNG, "image/png"))).toEqual({ ok: true, value: { created: true } });
    expect(await uploadWorkCover("2", file(PNG, "image/png"))).toEqual({ ok: true, value: { created: false } });
    expect(calls[0].headers["Content-Type"]).toBe("image/png");
    expect(calls[0].url).not.toContain(TOKEN);
  });

  test("a malformed answer is rejected", async () => {
    storeToken();
    mockFetch(() => json(200, { items: [{ id: 1 }], total: 1 }));
    expect((await listAdminWorks(20, 0)).ok).toBe(false);
  });
});

describe("works list and create form", () => {
  function open(routes: Record<string, H> = {}) {
    const api = server("OPERATOR", { "GET /api/works": () => json(200, { items: [item(2), item(1, { isPublic: true, isFeatured: true, isBanner: true, hasCover: false })], total: 2 }), ...routes });
    renderWithAuth(<WorksAdminPage />);
    return api;
  }
  const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  test("lists works with state badges, counts and an edit link; non-operators see only the denied notice", async () => {
    open();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("추천")).toBeTruthy();
    expect(within(table).getByText("배너")).toBeTruthy();
    expect(within(table).getByText("표지 없음")).toBeTruthy();
    expect(within(table).getAllByText("1 / 2").length).toBe(2);
    expect(within(table).getByRole("link", { name: "작품2 편집" }).getAttribute("href")).toBe("/works-admin/2");
  });

  test("a translator cannot use it and no works request is made", async () => {
    const { calls } = server("TRANSLATOR");
    renderWithAuth(<WorksAdminPage />);
    expect(await screen.findByText(/운영자만 사용할 수 있습니다/)).toBeTruthy();
    expect(calls.some((call) => call.path === "/api/works")).toBe(false);
  });

  test("the form validates locally first; at most three genres can be picked", async () => {
    const { calls } = open();
    await screen.findByRole("table");
    click("작품 만들기");
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(3);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    for (const genre of ["판타지", "액션", "로맨스"]) fireEvent.click(screen.getByLabelText(genre));
    expect((screen.getByLabelText("코미디") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("액션"));
    expect((screen.getByLabelText("코미디") as HTMLInputElement).disabled).toBe(false);
  });

  test("a valid form creates a private work and opens its screen; one click makes one request", async () => {
    const pending = deferred<Response>();
    const { calls } = open({ "POST /api/works": () => pending.promise });
    await screen.findByRole("table");
    typeIn("제목", "  새 작품  "); typeIn("작가", "작가"); typeIn("소개", "줄1\n줄2");
    fireEvent.change(screen.getByLabelText("읽기 방향"), { target: { value: "LTR" } });
    fireEvent.click(screen.getByLabelText("판타지")); fireEvent.click(screen.getByLabelText("액션"));
    click("작품 만들기"); click("만드는 중…");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    await act(async () => { pending.resolve(json(201, { id: "9", revision: 1 })); });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/works-admin/9"));
    expect(bodyOf(calls.find((call) => call.method === "POST")!)).toEqual({ title: "새 작품", author: "작가", description: "줄1\n줄2", readingDirection: "LTR", genres: ["판타지", "액션"] });
  });

  test("a server rejection shows a fixed message and keeps the input", async () => {
    open({ "POST /api/works": () => json(400, errorBody("INVALID_REQUEST")) });
    await screen.findByRole("table");
    typeIn("제목", "T"); typeIn("작가", "A"); fireEvent.click(screen.getByLabelText("드라마"));
    click("작품 만들기");
    expect(await screen.findByText(/입력값이 서버 규칙에 맞지 않습니다/)).toBeTruthy();
    expect((screen.getByLabelText("제목") as HTMLInputElement).value).toBe("T");
    expect(storedToken()).not.toBeNull();
  });

  test("an empty list and a failing list are told apart; the failure can be retried", async () => {
    let healthy = false;
    open({ "GET /api/works": () => (healthy ? json(200, { items: [], total: 0 }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByText("아직 작품이 없습니다.")).toBeTruthy();
  });
});

describe("work editor", () => {
  function open(routes: Record<string, H> = {}, body: unknown = detail()) {
    const api = server("OPERATOR", { "GET /api/works/7": () => json(200, body), "GET /api/works/7/cover": () => imageResponse(), ...routes });
    renderWithAuth(<WorkAdminPage />);
    return api;
  }
  const form = () => screen.getByRole("form", { name: "작품 정보" });

  test("shows the work, its cover from a Blob URL (released again) and the linked episodes with their state", async () => {
    const { calls } = open();
    expect(await screen.findByRole("heading", { name: "작품7" })).toBeTruthy();
    expect((screen.getByLabelText("제목") as HTMLInputElement).value).toBe("작품7");
    expect((screen.getByLabelText("소개") as HTMLTextAreaElement).value).toBe("소개");
    expect((screen.getByLabelText("액션") as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByRole("img", { name: "현재 표지" })).toBeTruthy();
    expect(calls.find((call) => call.path === "/api/works/7/cover")!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const episodes = screen.getByRole("region", { name: "연결된 회차" });
    expect(within(episodes).getByText("공개 중")).toBeTruthy();
    expect(within(episodes).getByText("미공개")).toBeTruthy();
    expect(within(episodes).getByRole("link", { name: "2화 · 2화" }).getAttribute("href")).toBe("/episodes/12");
  });

  test("save is available only after a change; it sends the loaded revision and the trimmed body, then reloads", async () => {
    let revision = 3;
    const { calls } = open({
      "PUT /api/works/7": () => { revision = 4; return json(200, { revision: 4, changed: true }); },
    });
    await screen.findByRole("heading", { name: "작품7" });
    const save = within(form()).getByRole("button", { name: "저장" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: " 새 제목 " } });
    fireEvent.click(screen.getByLabelText(/운영자 추천/));
    expect(save.disabled).toBe(false);
    expect(screen.getByText("저장하지 않은 변경이 있습니다.")).toBeTruthy();
    fireEvent.click(save);
    expect(await screen.findByText("저장했습니다.")).toBeTruthy();
    expect(bodyOf(calls.find((call) => call.method === "PUT")!)).toEqual({ expectedRevision: 3, title: "새 제목", author: "작가7", description: "소개", readingDirection: "RTL", genres: ["판타지", "액션"], isPublic: false, isFeatured: true, isBanner: false });
    expect(calls.filter((call) => call.method === "GET" && call.path === "/api/works/7")).toHaveLength(2);
    expect(revision).toBe(4);
  });

  test("'no change' from the server is reported plainly", async () => {
    open({ "PUT /api/works/7": () => json(200, { revision: 3, changed: false }) });
    await screen.findByRole("heading", { name: "작품7" });
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "작품7 " } }); // trims to the same text, so the form is not dirty
    expect((within(form()).getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("소개"), { target: { value: "다름" } });
    click("저장");
    expect(await screen.findByText("변경 사항이 없습니다.")).toBeTruthy();
  });

  test("local validation blocks the request", async () => {
    const { calls } = open();
    await screen.findByRole("heading", { name: "작품7" });
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "   " } });
    click("저장");
    expect(screen.getByText("제목은 1~100자로 입력하세요.")).toBeTruthy();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  test("a revision conflict keeps the typed input and offers an explicit reload", async () => {
    let reloaded = false;
    open({ "PUT /api/works/7": () => json(409, { error: { code: "REVISION_CONFLICT", message: "x", latestRevision: 5 } }), "GET /api/works/7": () => json(200, reloaded ? detail({ title: "서버 제목", revision: 5 }) : detail()) });
    await screen.findByRole("heading", { name: "작품7" });
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "내 제목" } });
    click("저장");
    expect(await screen.findByText(/다른 곳에서 작품이 변경되었습니다/)).toBeTruthy();
    expect((screen.getByLabelText("제목") as HTMLInputElement).value).toBe("내 제목");
    reloaded = true;
    click(/최신 내용 불러오기/);
    await waitFor(() => expect((screen.getByLabelText("제목") as HTMLInputElement).value).toBe("서버 제목"));
    expect(screen.queryByRole("button", { name: /최신 내용 불러오기/ })).toBeNull();
  });

  test.each([
    ["BANNER_LIMIT", /배너는 동시에 5개까지/], ["COVER_REQUIRED", /표지가 있는 작품만 배너/],
  ])("a %s refusal shows its fixed message and keeps the form", async (reason, message) => {
    open({ "PUT /api/works/7": () => json(409, { error: { code: "STATE_CONFLICT", message: "x", reason } }) });
    await screen.findByRole("heading", { name: "작품7" });
    fireEvent.click(screen.getByLabelText(/메인 배너/));
    click("저장");
    expect(await screen.findByText(message)).toBeTruthy();
    expect((screen.getByLabelText(/메인 배너/) as HTMLInputElement).checked).toBe(true);
  });

  test("a work without a cover cannot be ticked as a banner (the server still decides)", async () => {
    open({ "GET /api/works/7/cover": () => json(404, errorBody("NOT_FOUND")) }, detail({ hasCover: false }));
    await screen.findByRole("heading", { name: "작품7" });
    expect((screen.getByLabelText(/메인 배너/) as HTMLInputElement).disabled).toBe(true);
    expect(await screen.findByText("표지가 없습니다.")).toBeTruthy();
    expect(screen.getByLabelText("표지 올리기")).toBeTruthy();
  });

  test("a cover is checked locally first, then uploaded; the preview and the banner option refresh", async () => {
    let covered = false;
    const { calls } = open({
      "GET /api/works/7/cover": () => (covered ? imageResponse() : json(404, errorBody("NOT_FOUND"))),
      "PUT /api/works/7/cover": () => { covered = true; return json(201, { contentType: "image/png", byteSize: 12, updatedAt: T }); },
    }, detail({ hasCover: false }));
    await screen.findByText("표지가 없습니다.");
    fireEvent.change(screen.getByLabelText("표지 올리기"), { target: { files: [file(PNG, "image/gif")] } });
    expect(await screen.findByText("PNG, JPEG, WEBP 이미지만 올릴 수 있습니다.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("표지 올리기"), { target: { files: [file([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0], "image/png")] } });
    expect(await screen.findByText("파일 내용이 선택한 이미지 형식과 맞지 않습니다.")).toBeTruthy();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    fireEvent.change(screen.getByLabelText("표지 올리기"), { target: { files: [file(PNG, "image/png")] } });
    expect(await screen.findByText("표지를 올렸습니다.")).toBeTruthy();
    expect(await screen.findByRole("img", { name: "현재 표지" })).toBeTruthy();
    expect((screen.getByLabelText(/메인 배너/) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByLabelText("표지 교체")).toBeTruthy();
  });

  test.each([[400, /형식\(PNG·JPEG·WEBP\)과 크기\(5 MiB 이하\)를 확인하세요/], [404, /작품 또는 회차를 찾을 수 없습니다/], [503, /서비스를 사용할 수 없습니다/]])("a cover upload answered with %s shows a fixed message", async (status, message) => {
    open({ "PUT /api/works/7/cover": () => json(status, errorBody("X")) });
    await screen.findByRole("heading", { name: "작품7" });
    fireEvent.change(screen.getByLabelText("표지 교체"), { target: { files: [file(PNG, "image/png")] } });
    expect(await screen.findByText(message)).toBeTruthy();
    expect(storedToken()).not.toBeNull();
  });

  test("an unknown work (404) and a failing load show a notice with the right way out", async () => {
    server("OPERATOR", { "GET /api/works/7": () => json(404, errorBody("NOT_FOUND")) });
    const first = renderWithAuth(<WorkAdminPage />);
    expect(await screen.findByText("작품을 찾을 수 없습니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "작품 목록으로" }).getAttribute("href")).toBe("/works-admin");
    first.unmount();
    let healthy = false;
    server("OPERATOR", { "GET /api/works/7": () => (healthy ? json(200, detail()) : json(503, errorBody("SERVICE_UNAVAILABLE"))), "GET /api/works/7/cover": () => imageResponse() });
    renderWithAuth(<WorkAdminPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByRole("heading", { name: "작품7" })).toBeTruthy();
  });

  test("an invalid id never calls the server", async () => {
    nav.params = { id: "abc" };
    const { calls } = server("OPERATOR");
    renderWithAuth(<WorkAdminPage />);
    expect(await screen.findByText("작품을 찾을 수 없습니다.")).toBeTruthy();
    expect(calls.some((call) => call.path.startsWith("/api/works"))).toBe(false);
  });
});

describe("episode work panel (28.6)", () => {
  function open(link: unknown, routes: Record<string, H> = {}) {
    const api = server("OPERATOR", {
      "GET /api/episodes/5/work": () => json(200, { work: link }),
      "GET /api/works": () => json(200, { items: [item(7), item(8)], total: 2 }),
      ...routes,
    });
    renderWithAuth(<OperatorGate><EpisodeWorkPanel episodeId="5" /></OperatorGate>);
    return api;
  }
  const panel = () => screen.getByRole("region", { name: "작품 연결" });

  test("an unlinked episode can be linked: work choice and episode number are required and validated", async () => {
    const { calls } = open(null, { "PUT /api/episodes/5/work": () => json(200, { workId: "8", episodeNo: 12 }) });
    expect(await screen.findByText("연결된 작품이 없습니다.")).toBeTruthy();
    const submit = within(panel()).getByRole("button", { name: "연결" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("작품"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("회차 번호"), { target: { value: "0" } });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText("회차 번호는 1~9999의 정수입니다.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("회차 번호"), { target: { value: "12" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(await screen.findByText("작품에 연결했습니다.")).toBeTruthy();
    expect(bodyOf(calls.find((call) => call.method === "PUT")!)).toEqual({ workId: "8", episodeNo: 12 });
  });

  test("a linked episode shows its work, can be changed or unlinked", async () => {
    let linked: unknown = { workId: "7", title: "작품7", episodeNo: 3 };
    const { calls } = open(linked, {
      "GET /api/episodes/5/work": () => json(200, { work: linked }),
      "DELETE /api/episodes/5/work": () => { linked = null; return new Response(null, { status: 204 }); },
    });
    expect(await screen.findByRole("link", { name: "작품7" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "작품7" }).getAttribute("href")).toBe("/works-admin/7");
    expect((screen.getByLabelText("작품") as HTMLSelectElement).value).toBe("7");
    expect((screen.getByLabelText("회차 번호") as HTMLInputElement).value).toBe("3");
    expect(screen.getByRole("button", { name: "변경" })).toBeTruthy();
    click("해제");
    expect(await screen.findByText("작품 연결을 해제했습니다.")).toBeTruthy();
    expect(await screen.findByText("연결된 작품이 없습니다.")).toBeTruthy();
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  test("a taken episode number is explained and nothing else changes", async () => {
    open(null, { "PUT /api/episodes/5/work": () => json(409, { error: { code: "STATE_CONFLICT", message: "x", reason: "EPISODE_NO_TAKEN" } }) });
    await screen.findByText("연결된 작품이 없습니다.");
    fireEvent.change(screen.getByLabelText("작품"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("회차 번호"), { target: { value: "1" } });
    click("연결");
    expect(await screen.findByText(/이미 쓰고 있는 회차 번호/)).toBeTruthy();
    expect(screen.getByText("연결된 작품이 없습니다.")).toBeTruthy();
  });

  test("no works yet points to the works screen; a failing link lookup offers a retry", async () => {
    open(null, { "GET /api/works": () => json(200, { items: [], total: 0 }) });
    expect(await screen.findByRole("link", { name: "작품을 만드세요" })).toBeTruthy();
  });

  test("a failing lookup is retried", async () => {
    let healthy = false;
    open(null, { "GET /api/episodes/5/work": () => (healthy ? json(200, { work: null }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    expect(await screen.findByRole("alert")).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByText("연결된 작품이 없습니다.")).toBeTruthy();
  });
});
