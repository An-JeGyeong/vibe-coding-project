import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AssignedDetailPage from "@/app/(auth)/assigned/[id]/page";
import { requestAiDraft } from "@/lib/translation/client";
import type { Role } from "@/lib/auth/types";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, TOKEN, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => ({ id: "7" }),
}));

const T = "2026-10-07T01:00:00.123456Z";
const AI = "POST /api/my/episodes/7/translations/2/ai-draft";
const episode = (role: string) => ({ id: "7", title: "1화", assignedRole: role, latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: null, text: "원문" }] } });
const summary = (versionNo: number, status: string) => ({ versionNo, status, sourceVersion: 3, revision: 1, createdAt: T, submittedAt: null, decision: null });
const blocks = (texts: (string | null)[]) => texts.map((text, i) => ({ seq: i + 1, pageNo: null, source: `원문 ${i + 1}`, text }));
const detail = (versionNo: number, status: string, texts: (string | null)[]) =>
  ({ ...summary(versionNo, status), editable: status === "DRAFT", blocks: blocks(texts), blockComments: [] });
const suggestion = (...seqs: number[]) => ({ versionNo: 2, provider: "mock", suggestions: seqs.map((seq) => ({ seq, text: `[AI 초안] 제안 ${seq}` })) });

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

function open(routes: Record<string, H> = {}, texts: (string | null)[] = ["저장된 번역", null, null]) {
  const api = server("TRANSLATOR", {
    "GET /api/my/episodes/7": () => json(200, episode("TRANSLATOR")),
    "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(2, "DRAFT")] }),
    "GET /api/my/episodes/7/translations/2": () => json(200, detail(2, "DRAFT", texts)),
    ...routes,
  });
  renderWithAuth(<AssignedDetailPage />);
  return api;
}

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const field = (n: number) => screen.getByLabelText(`블록 ${n} 번역`) as HTMLTextAreaElement;
const posts = (calls: FetchCall[]) => calls.filter((call) => call.method === "POST");
const writes = (calls: FetchCall[]) => calls.filter((call) => call.method === "PUT" || call.path.endsWith("/submit"));

describe("AI draft request (CONTRACTS 25.1)", () => {
  test("is a body-less POST with the token; suggestions are read, anything malformed is refused", async () => {
    const { calls } = server("TRANSLATOR", { [AI]: () => json(200, suggestion(2, 3)) });
    expect(await requestAiDraft("7", 2)).toEqual({ ok: true, value: suggestion(2, 3) });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/my/episodes/7/translations/2/ai-draft");
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    for (const body of [{}, { versionNo: 2, provider: "mock", suggestions: [{ seq: "2", text: "x" }] }, { versionNo: 2, provider: "mock", suggestions: [{ seq: 2, text: 5 }] }]) {
      server("TRANSLATOR", { [AI]: () => json(200, body) });
      expect((await requestAiDraft("7", 2)).ok, JSON.stringify(body)).toBe(false);
    }
  });

  test("the AI failure code has its own kind; a conflict and the usual statuses map as before", async () => {
    server("TRANSLATOR", { [AI]: () => json(503, errorBody("AI_UNAVAILABLE")) });
    expect(await requestAiDraft("7", 2)).toEqual({ ok: false, failure: { kind: "ai_unavailable" } });
    server("TRANSLATOR", { [AI]: () => json(503, errorBody("SERVICE_UNAVAILABLE")) });
    expect(await requestAiDraft("7", 2)).toEqual({ ok: false, failure: { kind: "unavailable" } });
    server("TRANSLATOR", { [AI]: () => json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "REVIEW_PENDING" } }) });
    expect(await requestAiDraft("7", 2)).toEqual({ ok: false, failure: { kind: "state_conflict", currentStatus: "REVIEW_PENDING" } });
    for (const [status, kind] of [[403, "forbidden"], [404, "not_found"], [400, "invalid_request"]] as const) {
      server("TRANSLATOR", { [AI]: () => json(status, errorBody("X")) });
      expect(await requestAiDraft("7", 2)).toEqual({ ok: false, failure: { kind } });
    }
    window.sessionStorage.clear();
    const { fn } = mockFetch(() => json(200, {}));
    expect(await requestAiDraft("7", 2)).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("AI draft in the translator workspace (CONTRACTS 25.4)", () => {
  test("only an editable draft offers the button; a read-only version does not", async () => {
    open({
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(1, "REVIEW_PENDING")] }),
      "GET /api/my/episodes/7/translations/1": () => json(200, detail(1, "REVIEW_PENDING", ["가", "나", "다"])),
    });
    await screen.findByText(/읽기 전용입니다/);
    expect(screen.queryByRole("button", { name: /AI 초안/ })).toBeNull();
  });

  test("a confirmation explains the external transfer; cancel sends nothing", async () => {
    const { calls } = open();
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    expect(screen.getByText(/원문이 외부 AI 서비스로 전송됩니다/)).toBeTruthy();
    expect(screen.getByText(/번역이 비어 있는 블록에만 제안이 채워지며/)).toBeTruthy();
    click("취소");
    expect(posts(calls)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "AI 초안 불러오기" })).toBeTruthy();
  });

  test("fills only the empty blocks, marks them, never overwrites saved text, and saves or submits nothing by itself", async () => {
    const { calls } = open({ [AI]: () => json(200, suggestion(1, 2, 3)) });
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    expect(await screen.findByText("AI 초안 2개를 채웠습니다. 검토하고 수정한 뒤 저장해야 반영됩니다.")).toBeTruthy();
    expect(field(1).value).toBe("저장된 번역"); // a block that already had text is untouched
    expect(field(2).value).toBe("[AI 초안] 제안 2");
    expect(field(3).value).toBe("[AI 초안] 제안 3");
    expect(screen.getAllByText("AI 초안", { selector: "span.badge" })).toHaveLength(2);
    expect(screen.getByText(/3\/3 블록 \(100%\)/)).toBeTruthy(); // progress counts the proposals as unsaved input
    expect(screen.getByText(/저장하지 않은 변경 포함/)).toBeTruthy();
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0].body).toBeUndefined();
    expect(writes(calls)).toHaveLength(0);
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("editing a proposal removes its mark; the normal save then sends exactly what the translator left in the editor", async () => {
    const { calls } = open({
      [AI]: () => json(200, suggestion(2, 3)),
      "PUT /api/my/episodes/7/translations/2": () => json(200, { revision: 2, changed: true }),
    });
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    await screen.findByText(/AI 초안 2개를 채웠습니다/);
    fireEvent.change(field(2), { target: { value: "내가 고친 번역" } });
    expect(screen.getAllByText("AI 초안", { selector: "span.badge" })).toHaveLength(1);
    click("저장");
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(JSON.parse(calls.find((call) => call.method === "PUT")!.body!)).toEqual({
      expectedRevision: 1, blocks: [{ seq: 1, text: "저장된 번역" }, { seq: 2, text: "내가 고친 번역" }, { seq: 3, text: "[AI 초안] 제안 3" }],
    });
  });

  test("a block the translator typed while the request ran keeps the typed text; the proposal for it is dropped", async () => {
    const pending = deferred<Response>();
    open({ [AI]: () => pending.promise });
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    fireEvent.change(field(2), { target: { value: "먼저 입력함" } });
    await act(async () => { pending.resolve(json(200, suggestion(2, 3))); });
    expect(await screen.findByText("AI 초안 1개를 채웠습니다. 검토하고 수정한 뒤 저장해야 반영됩니다.")).toBeTruthy();
    expect(field(2).value).toBe("먼저 입력함");
    expect(field(3).value).toBe("[AI 초안] 제안 3");
  });

  test("no usable proposal gives a neutral notice and changes nothing", async () => {
    open({ [AI]: () => json(200, { versionNo: 2, provider: "mock", suggestions: [{ seq: 9, text: "없는 블록" }] }) });
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    expect(await screen.findByText("채울 블록이 없거나 제안을 받지 못했습니다.")).toBeTruthy();
    expect(field(2).value).toBe("");
    expect(screen.queryByText("AI 초안", { selector: "span.badge" })).toBeNull();
  });

  test("an AI failure keeps the input, says the translator can work by hand, and offers a retry", async () => {
    let healthy = false;
    open({ [AI]: () => (healthy ? json(200, suggestion(2)) : json(503, errorBody("AI_UNAVAILABLE"))) });
    await screen.findByLabelText("블록 1 번역");
    fireEvent.change(field(3), { target: { value: "내 입력" } });
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    expect(await screen.findByText("AI 초안을 만들지 못했습니다. 직접 번역할 수 있습니다.")).toBeTruthy();
    expect(field(3).value).toBe("내 입력");
    expect(storedToken()).not.toBeNull();
    healthy = true;
    click("AI 초안 다시 시도");
    click("AI 초안 요청");
    expect(await screen.findByText(/AI 초안 1개를 채웠습니다/)).toBeTruthy();
  });

  test("a state conflict explains it and offers the reload; a 401 signs out", async () => {
    open({ [AI]: () => json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "INVALIDATED" } }) });
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    expect(await screen.findByText(/원문이 변경되어 이 번역은 무효화되었습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /최신 내용 불러오기/ })).toBeTruthy();
  });

  test("401 on the request signs out", async () => {
    open({ [AI]: () => json(401, errorBody("AUTH_REQUIRED")) });
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    await waitFor(() => expect(storedToken()).toBeNull());
  });

  test("while the request runs the buttons are blocked (no duplicate request)", async () => {
    const pending = deferred<Response>();
    const { calls } = open({ [AI]: () => pending.promise });
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    const working = screen.getByRole("button", { name: "AI 초안을 만드는 중…" }) as HTMLButtonElement;
    expect(working.disabled).toBe(true);
    fireEvent.click(working);
    expect((screen.getByRole("button", { name: "검수에 제출" }) as HTMLButtonElement).disabled).toBe(true);
    expect(posts(calls)).toHaveLength(1);
    await act(async () => { pending.resolve(json(200, suggestion(2))); });
    await screen.findByText(/AI 초안 1개를 채웠습니다/);
  });

  test("an answer that arrives after the translator moved to another version is ignored", async () => {
    const pending = deferred<Response>();
    open({
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary(2, "DRAFT"), summary(1, "REJECTED")] }),
      "GET /api/my/episodes/7/translations/1": () => json(200, detail(1, "REJECTED", ["옛 1", null, null])),
      [AI]: () => pending.promise,
    });
    await screen.findByLabelText("블록 1 번역");
    click("AI 초안 불러오기");
    click("AI 초안 요청");
    fireEvent.click(screen.getByRole("button", { name: "v1 보기" }));
    await screen.findByText("옛 1");
    await act(async () => { pending.resolve(json(200, suggestion(2, 3))); });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText(/AI 초안 \d+개를 채웠습니다/)).toBeNull();
    expect(screen.queryByText("AI 초안", { selector: "span.badge" })).toBeNull();
  });
});
