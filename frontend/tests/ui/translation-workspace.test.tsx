import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AssignedDetailPage from "@/app/(auth)/assigned/[id]/page";
import type { Role } from "@/lib/auth/types";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), id: "7" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => ({ id: nav.id }),
}));

const T = "2026-10-06T01:00:00.123456Z";
const episode = (role: "TRANSLATOR" | "REVIEWER" = "TRANSLATOR", withSource = true) => ({
  id: "7", title: "1화", assignedRole: role, latestSourceVersion: withSource ? 2 : 0,
  source: withSource ? { version: 2, savedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "원문 하나" }, { seq: 2, pageNo: null, text: "원문 둘" }] } : null,
});
type Status = "DRAFT" | "REVIEW_PENDING" | "REJECTED" | "INVALIDATED";
const summary = (versionNo: number, status: Status, revision = 1, sourceVersion = 2) =>
  ({ versionNo, status, sourceVersion, revision, createdAt: T, submittedAt: status === "DRAFT" ? null : T });
const detail = (versionNo: number, status: Status, texts: (string | null)[], revision = 1) => ({
  ...summary(versionNo, status, revision), editable: status === "DRAFT",
  blocks: [{ seq: 1, pageNo: 1, source: "원문 하나", text: texts[0] }, { seq: 2, pageNo: null, source: "원문 둘", text: texts[1] }],
});
const list = (...items: ReturnType<typeof summary>[]) => ({ latestSourceVersion: 2, items });

type H = (call: FetchCall) => Response | Promise<Response>;
function server(routes: Record<string, H>, role: Role = "TRANSLATOR", episodeBody: unknown = episode()) {
  storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody(role));
    if (call.method === "GET" && call.path === "/api/my/episodes/7") return json(200, episodeBody);
    const handler = routes[`${call.method} ${call.path}`];
    if (handler) return handler(call);
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}

beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); nav.id = "7"; });

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const field = (seq: number) => screen.getByLabelText(`블록 ${seq} 번역`) as HTMLTextAreaElement;
const type = (seq: number, value: string) => fireEvent.change(field(seq), { target: { value } });
const translationCalls = (calls: FetchCall[]) => calls.filter((call) => call.path.includes("/translations"));
const puts = (calls: FetchCall[]) => calls.filter((call) => call.method === "PUT");
const BASE = "/api/my/episodes/7/translations";

async function openDraft(extra: Record<string, H> = {}, texts: (string | null)[] = ["첫 번역", null], revision = 1) {
  const api = server({
    [`GET ${BASE}`]: () => json(200, list(summary(1, "DRAFT", revision))),
    [`GET ${BASE}/1`]: () => json(200, detail(1, "DRAFT", texts, revision)),
    ...extra,
  });
  renderWithAuth(<AssignedDetailPage />);
  await screen.findByLabelText("블록 1 번역");
  return api;
}

describe("starting a translation", () => {
  test("with no versions it explains and offers to start; starting loads the new draft", async () => {
    let created = false;
    const { calls } = server({
      [`GET ${BASE}`]: () => json(200, created ? list(summary(1, "DRAFT")) : list()),
      [`GET ${BASE}/1`]: () => json(200, detail(1, "DRAFT", [null, null])),
      [`POST ${BASE}`]: () => { created = true; return json(201, { versionNo: 1, status: "DRAFT", sourceVersion: 2, revision: 1 }); },
    });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText(/아직 번역이 없습니다/)).toBeTruthy();
    click("새 번역 시작");
    expect(await screen.findByText("새 번역(버전 1)을 시작했습니다.")).toBeTruthy();
    expect(field(1).value).toBe("");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "새 번역 시작" })).toBeNull();
  });

  test("a conflict because a version is already open shows the state and reloads", async () => {
    let open = false;
    server({
      [`GET ${BASE}`]: () => json(200, open ? list(summary(1, "DRAFT")) : list()),
      [`GET ${BASE}/1`]: () => json(200, detail(1, "DRAFT", ["이미 있음", null])),
      [`POST ${BASE}`]: () => { open = true; return json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "DRAFT" } }); },
    });
    renderWithAuth(<AssignedDetailPage />);
    await screen.findByText(/아직 번역이 없습니다/);
    click("새 번역 시작");
    expect((await screen.findByLabelText("블록 1 번역") as HTMLTextAreaElement).value).toBe("이미 있음");
  });

  test("an episode without source never calls a translation API", async () => {
    const { calls } = server({}, "TRANSLATOR", episode("TRANSLATOR", false));
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText("운영자가 원문을 저장하면 여기에 표시됩니다.")).toBeTruthy();
    expect(translationCalls(calls)).toHaveLength(0);
  });
});

describe("side-by-side draft editor", () => {
  test("shows the source next to each translation field with page numbers and the version table", async () => {
    await openDraft();
    expect(screen.getByText("원문 하나")).toBeTruthy();
    expect(screen.getByText("p.1")).toBeTruthy();
    expect(field(1).value).toBe("첫 번역");
    expect(field(2).value).toBe("");
    expect(screen.getByText("원문 v2 (최신)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("saving sends expectedRevision and only the blocks that have text, then reloads", async () => {
    let revision = 1;
    const { calls } = await openDraft({
      [`PUT ${BASE}/1`]: () => { revision = 2; return json(200, { revision: 2, changed: true }); },
      [`GET ${BASE}/1`]: () => json(200, revision === 1 ? detail(1, "DRAFT", ["첫 번역", null], 1)
        : detail(1, "DRAFT", ["  첫 번역 수정\n둘째 줄  ", "두 번째"], revision)),
    });
    type(1, "  첫 번역 수정\n둘째 줄  ");
    type(2, "두 번째");
    click("저장");
    expect(await screen.findByText("번역을 저장했습니다.")).toBeTruthy();
    expect(JSON.parse(puts(calls)[0].body!)).toEqual({ expectedRevision: 1, blocks: [{ seq: 1, text: "  첫 번역 수정\n둘째 줄  " }, { seq: 2, text: "두 번째" }] });
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("clearing a block omits it from the request", async () => {
    const { calls } = await openDraft({ [`PUT ${BASE}/1`]: () => json(200, { revision: 2, changed: true }) });
    type(1, "");
    click("저장");
    await screen.findByText("번역을 저장했습니다.");
    expect(JSON.parse(puts(calls)[0].body!)).toEqual({ expectedRevision: 1, blocks: [] });
  });

  test("whitespace-only or oversized text is rejected locally and nothing is sent", async () => {
    const { calls } = await openDraft();
    type(2, "   ");
    click("저장");
    expect(await screen.findByText("공백만 입력할 수 없습니다.")).toBeTruthy();
    type(2, "가".repeat(4001));
    click("저장");
    expect(await screen.findByText(/4000자 이하/)).toBeTruthy();
    expect(puts(calls)).toHaveLength(0);
  });

  test("an unchanged answer from the server is reported as such", async () => {
    await openDraft({ [`PUT ${BASE}/1`]: () => json(200, { revision: 1, changed: false }) });
    type(2, "새 내용");
    click("저장");
    expect(await screen.findByText("변경 사항이 없어 저장하지 않았습니다.")).toBeTruthy();
  });

  test("double click on save sends one request", async () => {
    const pending = deferred<Response>();
    const { calls } = await openDraft({ [`PUT ${BASE}/1`]: () => pending.promise });
    type(2, "번역");
    click("저장");
    fireEvent.click(screen.getByRole("button", { name: "저장 중…" }));
    expect(puts(calls)).toHaveLength(1);
    await act(async () => { pending.resolve(json(200, { revision: 2, changed: true })); });
    expect(await screen.findByText("번역을 저장했습니다.")).toBeTruthy();
  });

  test("drafts stay in memory only", async () => {
    await openDraft();
    type(2, "저장하지 않은 번역");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(1);
    expect(document.cookie).toBe("");
  });
});

describe("submitting", () => {
  test("is blocked while there are unsaved changes", async () => {
    await openDraft({}, ["첫 번역", "둘째"]);
    expect((screen.getByRole("button", { name: "검수에 제출" }) as HTMLButtonElement).disabled).toBe(false);
    type(2, "수정");
    expect((screen.getByRole("button", { name: "검수에 제출" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("저장한 뒤에 제출할 수 있습니다.")).toBeTruthy();
  });

  test("asks for confirmation because it cannot be undone, then submits the saved revision", async () => {
    let submitted = false;
    const { calls } = await openDraft({
      [`POST ${BASE}/1/submit`]: () => { submitted = true; return json(200, { versionNo: 1, status: "REVIEW_PENDING", submittedAt: T }); },
      [`GET ${BASE}`]: () => json(200, list(submitted ? summary(1, "REVIEW_PENDING", 3) : summary(1, "DRAFT", 3))),
      [`GET ${BASE}/1`]: () => json(200, submitted ? detail(1, "REVIEW_PENDING", ["가", "나"], 3) : detail(1, "DRAFT", ["가", "나"], 3)),
    }, ["가", "나"], 3);
    click("검수에 제출");
    expect(screen.getByText("제출하면 수정할 수 없습니다. 제출할까요?")).toBeTruthy();
    click("취소");
    expect(screen.queryByText("제출하면 수정할 수 없습니다. 제출할까요?")).toBeNull();
    expect(calls.filter((call) => call.path.endsWith("/submit"))).toHaveLength(0);
    click("검수에 제출");
    click("제출 확정");
    expect(await screen.findByText("검수에 제출했습니다. 제출한 번역은 수정할 수 없습니다.")).toBeTruthy();
    expect(JSON.parse(calls.find((call) => call.path.endsWith("/submit"))!.body!)).toEqual({ expectedRevision: 3 });
    expect(screen.queryByLabelText("블록 1 번역")).toBeNull();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.getByText("가")).toBeTruthy();
  });

  test("missing blocks are marked locally and nothing is sent", async () => {
    const { calls } = await openDraft();
    click("검수에 제출");
    click("제출 확정");
    expect(await screen.findByText(/번역하지 않은 블록이 1개 있습니다/)).toBeTruthy();
    expect(screen.getByText("번역이 필요합니다.")).toBeTruthy();
    expect(calls.filter((call) => call.path.endsWith("/submit"))).toHaveLength(0);
    type(2, "채움");
    expect(screen.queryByText("번역이 필요합니다.")).toBeNull();
  });

  test("the server's missingSeqs are marked the same way", async () => {
    await openDraft({ [`POST ${BASE}/1/submit`]: () => json(400, { error: { code: "INCOMPLETE_TRANSLATION", message: "x", missingSeqs: [2] } }) }, ["가", "나"]);
    click("검수에 제출");
    click("제출 확정");
    expect(await screen.findByText(/번역하지 않은 블록이 1개 있습니다/)).toBeTruthy();
    expect(screen.getByText("번역이 필요합니다.")).toBeTruthy();
  });
});

describe("conflicts and failures", () => {
  test("a revision conflict keeps the draft and loads the latest content only on request", async () => {
    let latest = false;
    await openDraft({
      [`PUT ${BASE}/1`]: () => json(409, { error: { code: "VERSION_CONFLICT", message: "x", latestRevision: 3 } }),
      [`GET ${BASE}/1`]: () => json(200, latest ? detail(1, "DRAFT", ["다른 곳의 내용", null], 3) : detail(1, "DRAFT", ["첫 번역", null])),
    });
    type(1, "내 초안");
    click("저장");
    expect(await screen.findByText(/다른 곳에서 번역이 변경되었습니다/)).toBeTruthy();
    expect(field(1).value).toBe("내 초안");
    latest = true;
    click(/최신 내용 불러오기/);
    await waitFor(() => expect(field(1).value).toBe("다른 곳의 내용"));
    expect(screen.queryByRole("button", { name: /최신 내용 불러오기/ })).toBeNull();
  });

  test("a state conflict because the source changed explains the invalidation and reloads read-only", async () => {
    let invalid = false;
    await openDraft({
      [`PUT ${BASE}/1`]: () => { invalid = true; return json(409, { error: { code: "STATE_CONFLICT", message: "x", currentStatus: "INVALIDATED" } }); },
      [`GET ${BASE}`]: () => json(200, list(invalid ? summary(1, "INVALIDATED") : summary(1, "DRAFT"))),
      [`GET ${BASE}/1`]: () => json(200, invalid ? detail(1, "INVALIDATED", ["첫 번역", null]) : detail(1, "DRAFT", ["첫 번역", null])),
    });
    type(2, "작성 중");
    click("저장");
    expect(await screen.findByText("원문이 변경되어 이 번역은 무효화되었습니다. 새 번역을 시작하세요.")).toBeTruthy();
    click(/최신 내용 불러오기/);
    await waitFor(() => expect(screen.queryByLabelText("블록 1 번역")).toBeNull());
    expect(screen.getByText(/원문이 바뀌어 무효화된 번역입니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "새 번역 시작" })).toBeTruthy();
  });

  test.each([
    ["403", () => json(403, errorBody("FORBIDDEN")), /권한이 없습니다/],
    ["404", () => json(404, errorBody("NOT_FOUND")), /찾을 수 없습니다/],
    ["503", () => json(503, errorBody("SERVICE_UNAVAILABLE")), /서비스를 사용할 수 없습니다/],
    ["network", () => { throw new TypeError("offline"); }, /서버에 연결할 수 없습니다/],
  ])("a failed save (%s) shows a fixed message, keeps the draft and the login", async (_name, respond, expected) => {
    await openDraft({ [`PUT ${BASE}/1`]: respond });
    type(2, "내 초안");
    click("저장");
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(field(2).value).toBe("내 초안");
    expect(storedToken()).not.toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  test("401 on save signs out and goes to /login", async () => {
    await openDraft({ [`PUT ${BASE}/1`]: () => json(401, errorBody("AUTH_REQUIRED")) });
    type(2, "내 초안");
    click("저장");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(storedToken()).toBeNull();
  });

  test("a load failure offers a retry", async () => {
    let healthy = false;
    server({
      [`GET ${BASE}`]: () => (healthy ? json(200, list()) : json(503, errorBody("SERVICE_UNAVAILABLE"))),
    });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText(/서비스를 사용할 수 없습니다/)).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByText(/아직 번역이 없습니다/)).toBeTruthy();
  });
});

describe("read-only versions", () => {
  test("a version waiting for review is shown without any edit control", async () => {
    server({
      [`GET ${BASE}`]: () => json(200, list(summary(2, "REVIEW_PENDING"), summary(1, "REJECTED"))),
      [`GET ${BASE}/2`]: () => json(200, detail(2, "REVIEW_PENDING", ["제출한 번역", "둘째"])),
      [`GET ${BASE}/1`]: () => json(200, detail(1, "REJECTED", ["예전 번역", null])),
    });
    renderWithAuth(<AssignedDetailPage />);
    expect(await screen.findByText("제출한 번역")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.queryByRole("button", { name: "새 번역 시작" })).toBeNull();
    click("v1 보기");
    expect(await screen.findByText("예전 번역")).toBeTruthy();
    expect(screen.getByText("(번역 없음)")).toBeTruthy();
  });

  test("switching versions is blocked while the draft has unsaved changes", async () => {
    server({
      [`GET ${BASE}`]: () => json(200, list(summary(2, "DRAFT"), summary(1, "REJECTED"))),
      [`GET ${BASE}/2`]: () => json(200, detail(2, "DRAFT", ["가", null])),
      [`GET ${BASE}/1`]: () => json(200, detail(1, "REJECTED", ["예전", null])),
    });
    renderWithAuth(<AssignedDetailPage />);
    await screen.findByLabelText("블록 1 번역");
    expect((screen.getByRole("button", { name: "v1 보기" }) as HTMLButtonElement).disabled).toBe(false);
    type(2, "수정 중");
    expect((screen.getByRole("button", { name: "v1 보기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("저장하지 않은 변경이 있어 다른 버전으로 이동할 수 없습니다.")).toBeTruthy();
  });
});

describe("other roles", () => {
  test("a reviewer keeps the read-only source and never calls a translation API", async () => {
    const { calls } = server({}, "REVIEWER", episode("REVIEWER"));
    renderWithAuth(<AssignedDetailPage />);
    const source = await screen.findByRole("region", { name: "원문 (읽기 전용)" });
    expect(within(source).getByText("원문 하나")).toBeTruthy();
    expect(translationCalls(calls)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "새 번역 시작" })).toBeNull();
  });

  test("an operator or reader sees a notice and no request is sent", async () => {
    for (const role of ["OPERATOR", "READER"] as const) {
      const { calls } = server({}, role);
      const view = renderWithAuth(<AssignedDetailPage />);
      expect(await screen.findByText(/번역가·감수자만 사용할 수 있습니다/)).toBeTruthy();
      expect(calls.filter((call) => call.path !== "/api/auth/me")).toHaveLength(0);
      view.unmount();
    }
  });
});
