import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AssignedDetailPage from "@/app/(auth)/assigned/[id]/page";
import { OperatorGate } from "@/components/OperatorGate";
import { TranslationOverviewPanel } from "@/components/TranslationOverviewPanel";
import ReviewDetailPage from "@/app/(auth)/reviews/[episodeId]/[versionNo]/page";
import type { Role } from "@/lib/auth/types";
import { fetchTranslatedImage, listTranslatedImages, uploadTranslatedImage } from "@/lib/translatedPages/client";
import { errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, TOKEN, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { id: "7", episodeId: "7", versionNo: "2" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
}));

const T = "2026-10-08T01:00:00.123456Z";
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const file = (bytes: number[], type: string, name = "t.png") => new File([new Uint8Array(bytes)], name, { type });
const imageResponse = () => new Response(new Blob([new Uint8Array(PNG)], { type: "image/png" }), { status: 200, headers: { "Content-Type": "image/png" } });
const meta = (pageNo: number) => ({ pageNo, contentType: "image/png", byteSize: 2048, updatedAt: T });

let urlCounter = 0;
let revoked: string[] = [];
beforeEach(() => {
  revoked = []; urlCounter = 0;
  URL.createObjectURL = vi.fn(() => `blob:t-${++urlCounter}`);
  URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url); });
  nav.params = { id: "7", episodeId: "7", versionNo: "2" };
});

type H = (call: FetchCall) => Response | Promise<Response>;
function server(role: Role, routes: Record<string, H>) {
  storeToken();
  return mockFetch((call) => {
    if (call.path === "/api/auth/me") return json(200, meBody(role));
    const handler = routes[`${call.method} ${call.path}`];
    if (handler) return handler(call);
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
}
const BASE = "/api/my/episodes/7/translations/2/page-images";

describe("translated page image client (27.2)", () => {
  test("paths per scope, bearer header only, bytes and upload statuses", async () => {
    storeToken();
    const { calls } = mockFetch((call) => {
      if (call.method === "PUT" && call.path.endsWith("/1")) return json(201, meta(1));
      if (call.method === "PUT" && call.path.endsWith("/2")) return json(200, meta(2));
      if (call.method === "PUT" && call.path.endsWith("/3")) return json(409, { error: { code: "STATE_CONFLICT", currentStatus: "REVIEW_PENDING" } });
      if (call.method === "PUT" && call.path.endsWith("/4")) return json(404, errorBody("NOT_FOUND"));
      if (call.path.endsWith("/page-images")) return json(200, { items: [meta(1)] });
      return imageResponse();
    });
    expect((await listTranslatedImages("operator", "7", 2)).ok).toBe(true);
    expect((await listTranslatedImages("mine", "7", 2)).ok).toBe(true);
    const bytes = await fetchTranslatedImage("mine", "7", 2, 1);
    expect(bytes.ok && bytes.value.type).toBe("image/png");
    const created = await uploadTranslatedImage("7", 2, 1, file(PNG, "image/png"));
    expect(created.ok && created.value.created).toBe(true);
    const replaced = await uploadTranslatedImage("7", 2, 2, file(PNG, "image/png"));
    expect(replaced.ok && replaced.value.created).toBe(false);
    const conflict = await uploadTranslatedImage("7", 2, 3, file(PNG, "image/png"));
    expect(!conflict.ok && conflict.failure).toEqual({ kind: "state_conflict", currentStatus: "REVIEW_PENDING" });
    const missing = await uploadTranslatedImage("7", 2, 4, file(PNG, "image/png"));
    expect(!missing.ok && missing.failure.kind).toBe("not_found");
    expect(calls.map((call) => call.path)).toContain("/api/episodes/7/translations/2/page-images");
    expect(calls.map((call) => call.path)).toContain(`${BASE}/1`);
    for (const call of calls) {
      expect(call.url).not.toContain(TOKEN);
      expect(call.headers.authorization ?? call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
    const put = calls.find((call) => call.method === "PUT")!;
    expect((put.headers["content-type"] ?? put.headers["Content-Type"])).toBe("image/png");
  });
});

describe("translated images in the screens (27.4)", () => {
  const blocks = [{ seq: 1, pageNo: 1, source: "원문 1", text: "가" }, { seq: 2, pageNo: 2, source: "원문 2", text: null }];
  const episode = { id: "7", title: "1화", assignedRole: "TRANSLATOR", latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "원문" }] } };
  const summary = { versionNo: 2, status: "DRAFT", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: null, decision: null };
  function translator(editable: boolean, routes: Record<string, H> = {}, status = "DRAFT") {
    const api = server("TRANSLATOR", {
      "GET /api/my/episodes/7": () => json(200, episode),
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [{ ...summary, status }] }),
      "GET /api/my/episodes/7/translations/2": () => json(200, { ...summary, status, editable, blocks, blockComments: [] }),
      "GET /api/my/episodes/7/pages": () => json(200, { items: [meta(1), meta(2)] }),
      "GET /api/my/episodes/7/pages/1/image": () => imageResponse(),
      "GET /api/my/episodes/7/pages/2/image": () => imageResponse(),
      ...routes,
    });
    renderWithAuth(<AssignedDetailPage />);
    return api;
  }
  const pick = (label: string, f: File) => fireEvent.change(screen.getByLabelText(label), { target: { files: [f] } });

  test("the original and the translated image sit side by side; a page without a translated image says so and offers the upload", async () => {
    translator(true, { [`GET ${BASE}`]: () => json(200, { items: [meta(1)] }), [`GET ${BASE}/1`]: () => imageResponse() });
    expect(await screen.findByRole("img", { name: "페이지 1 원본 이미지" })).toBeTruthy();
    expect(await screen.findByRole("img", { name: "페이지 1 번역본 이미지" })).toBeTruthy();
    expect(screen.getByLabelText("페이지 1 번역본 이미지 교체")).toBeTruthy();
    // a scrollable image box must be reachable with the keyboard (axe: scrollable-region-focusable)
    expect(screen.getByRole("group", { name: "페이지 1 번역본 이미지 (스크롤 가능)" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("group", { name: "페이지 1 원본 이미지 (스크롤 가능)" }).getAttribute("tabindex")).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(await screen.findByText("이 페이지에는 번역본 이미지가 없습니다.")).toBeTruthy();
    expect(screen.getByLabelText("페이지 2 번역본 이미지 올리기")).toBeTruthy();
    expect(revoked.length).toBeGreaterThan(0); // the page-1 Blob URLs were released when the page changed
  });

  test("an upload is checked locally first: a wrong type or mismatching bytes never reach the server", async () => {
    const { calls } = translator(true, { [`GET ${BASE}`]: () => json(200, { items: [] }) });
    await screen.findByLabelText("페이지 1 번역본 이미지 올리기");
    pick("페이지 1 번역본 이미지 올리기", file(PNG, "image/gif", "a.gif"));
    expect(await screen.findByText("PNG, JPEG, WEBP 이미지만 올릴 수 있습니다.")).toBeTruthy();
    pick("페이지 1 번역본 이미지 올리기", file([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0], "image/png"));
    expect(await screen.findByText("파일 내용이 선택한 이미지 형식과 맞지 않습니다.")).toBeTruthy();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  test("a successful upload reloads the list and shows the new translated image; no duplicate upload while it runs", async () => {
    let stored = false;
    const { calls } = translator(true, {
      [`GET ${BASE}`]: () => json(200, { items: stored ? [meta(1)] : [] }),
      [`GET ${BASE}/1`]: () => imageResponse(),
      [`PUT ${BASE}/1`]: () => { stored = true; return json(201, meta(1)); },
    });
    await screen.findByLabelText("페이지 1 번역본 이미지 올리기");
    pick("페이지 1 번역본 이미지 올리기", file(PNG, "image/png"));
    expect(await screen.findByText("번역본 이미지를 올렸습니다.")).toBeTruthy();
    expect(await screen.findByRole("img", { name: "페이지 1 번역본 이미지" })).toBeTruthy();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(storedToken()).not.toBeNull();
  });

  test.each([
    [409, /제출되었거나 수정할 수 없는 번역/],
    [404, /담당 번역가가 아닙니다/],
    [400, /형식\(PNG·JPEG·WEBP\)과 크기\(5 MiB 이하\)를 확인하세요/],
    [503, /서비스를 사용할 수 없습니다/],
  ])("an upload answered with %s shows a fixed message and keeps the login", async (status, message) => {
    translator(true, {
      [`GET ${BASE}`]: () => json(200, { items: [] }),
      [`PUT ${BASE}/1`]: () => json(status, status === 409 ? { error: { code: "STATE_CONFLICT", currentStatus: "REVIEW_PENDING" } } : errorBody("X")),
    });
    await screen.findByLabelText("페이지 1 번역본 이미지 올리기");
    pick("페이지 1 번역본 이미지 올리기", file(PNG, "image/png"));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(storedToken()).not.toBeNull();
  });

  test("a version that cannot be edited (submitted) shows the image read-only, without an upload control", async () => {
    translator(false, { [`GET ${BASE}`]: () => json(200, { items: [meta(1)] }), [`GET ${BASE}/1`]: () => imageResponse() }, "REVIEW_PENDING");
    expect(await screen.findByRole("img", { name: "페이지 1 번역본 이미지" })).toBeTruthy();
    expect(screen.queryByLabelText(/번역본 이미지 (올리기|교체)/)).toBeNull();
  });

  test("when the translated list cannot be loaded the text work continues, a retry is offered, and there is no upload control yet", async () => {
    let healthy = false;
    translator(true, { [`GET ${BASE}`]: () => (healthy ? json(200, { items: [meta(1)] }) : json(503, errorBody("SERVICE_UNAVAILABLE"))), [`GET ${BASE}/1`]: () => imageResponse() });
    expect(await screen.findByText(/번역본 이미지를 불러오지 못했습니다. 텍스트 작업은 계속할 수 있습니다/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("블록 1 번역"), { target: { value: "계속" } });
    healthy = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("img", { name: "페이지 1 번역본 이미지" })).toBeTruthy();
    expect((screen.getByLabelText("블록 1 번역") as HTMLTextAreaElement).value).toBe("계속");
  });

  test("the reviewer sees translated images read-only through the reviewer's own paths", async () => {
    const { calls } = server("REVIEWER", {
      "GET /api/my/episodes/7/reviews/2": () => json(200, { versionNo: 2, status: "REVIEW_PENDING", sourceVersion: 3, submittedAt: T, decidable: true, decision: null, blocks, blockComments: [] }),
      "GET /api/my/episodes/7/pages": () => json(200, { items: [meta(1)] }),
      "GET /api/my/episodes/7/pages/1/image": () => imageResponse(),
      [`GET ${BASE}`]: () => json(200, { items: [meta(1)] }),
      [`GET ${BASE}/1`]: () => imageResponse(),
    });
    renderWithAuth(<ReviewDetailPage />);
    expect(await screen.findByRole("img", { name: "페이지 1 번역본 이미지" })).toBeTruthy();
    expect(screen.queryByLabelText(/번역본 이미지 (올리기|교체)/)).toBeNull();
    await waitFor(() => expect(calls.some((call) => call.path === `${BASE}/1`)).toBe(true));
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });
});

describe("publish confirmation: pages without a translated image (27.4)", () => {
  const approved = { decision: "APPROVED", decidedAt: T, reason: null };
  const summary = { versionNo: 2, status: "APPROVED", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: T, decision: approved };
  const detailBlocks = [{ seq: 1, pageNo: 1, source: "a", text: "가" }, { seq: 2, pageNo: 2, source: "b", text: "나" }, { seq: 3, pageNo: 3, source: "c", text: "다" }, { seq: 4, pageNo: null, source: "d", text: "라" }];
  async function openOperator(images: unknown) {
    const api = server("OPERATOR", {
      "GET /api/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary] }),
      "GET /api/episodes/7/publication": () => json(200, { current: null, history: [] }),
      "GET /api/episodes/7/translations/2": () => json(200, { ...summary, blocks: detailBlocks, blockComments: [] }),
      "GET /api/episodes/7/translations/2/page-images": () => (images === null ? json(503, errorBody("SERVICE_UNAVAILABLE")) : json(200, images)),
      "GET /api/episodes/7/pages": () => json(200, { items: [] }),
    });
    renderWithAuth(<OperatorGate><TranslationOverviewPanel episodeId="7" /></OperatorGate>);
    await screen.findByRole("region", { name: "공개 상태" });
    await screen.findByText("승인됨");
    return api;
  }

  test("the confirmation says how many numbered pages have no translated image, and still lets the operator publish", async () => {
    const { calls } = await openOperator({ items: [meta(1)] });
    fireEvent.click(screen.getByRole("button", { name: "v2 발행" }));
    expect(await screen.findByText(/번역본 이미지가 없는 페이지가 2개 있습니다/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "발행 확정" }) as HTMLButtonElement).disabled).toBe(false); // advisory only
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  test("nothing is added when every numbered page has an image, or when the lookup fails", async () => {
    const first = await openOperator({ items: [meta(1), meta(2), meta(3)] });
    fireEvent.click(screen.getByRole("button", { name: "v2 발행" }));
    await waitFor(() => expect(first.calls.some((call) => call.path === "/api/episodes/7/translations/2/page-images")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText(/번역본 이미지가 없는 페이지/)).toBeNull();
    expect(screen.getByText(/발행하면 독자에게 공개됩니다/)).toBeTruthy();
  });

  test("a failed lookup only hides the extra sentence", async () => {
    await openOperator(null);
    fireEvent.click(screen.getByRole("button", { name: "v2 발행" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText(/번역본 이미지가 없는 페이지/)).toBeNull();
    expect(screen.getByRole("button", { name: "발행 확정" })).toBeTruthy();
  });
});
