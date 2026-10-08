import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AssignedDetailPage from "@/app/(auth)/assigned/[id]/page";
import ReviewDetailPage from "@/app/(auth)/reviews/[episodeId]/[versionNo]/page";
import { PageImage } from "@/components/PageImage";
import { PageImagesPanel } from "@/components/PageImagesPanel";
import { fetchPageImage, listPageImages, uploadPageImage } from "@/lib/pages/client";
import { MAX_IMAGE_BYTES } from "@/lib/pages/types";
import { signatureMatches, validateImageFile } from "@/lib/pages/validation";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import type { Role } from "@/lib/auth/types";
import { deferred, errorBody, json, meBody, mockFetch, renderWithAuth, storedToken, storeToken, TOKEN, type FetchCall } from "./helpers";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: { id: "7", episodeId: "7", versionNo: "2" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
}));

const T = "2026-10-07T01:00:00.123456Z";
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
const file = (bytes: number[], type: string, name = "page.png") => new File([new Uint8Array(bytes)], name, { type });
const imageResponse = (bytes = PNG, type = "image/png") => new Response(new Blob([new Uint8Array(bytes)], { type }), { status: 200, headers: { "Content-Type": type } });
const meta = (pageNo: number, byteSize = 2048) => ({ pageNo, contentType: "image/png", byteSize, updatedAt: T });

let urlCounter = 0;
let created: string[] = [];
let revoked: string[] = [];
beforeEach(() => {
  created = []; revoked = []; urlCounter = 0;
  URL.createObjectURL = vi.fn(() => { const url = `blob:test-${++urlCounter}`; created.push(url); return url; });
  URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url); });
  nav.push.mockClear(); nav.replace.mockClear(); nav.params = { id: "7", episodeId: "7", versionNo: "2" };
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
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const pick = (label: string, f: File) => fireEvent.change(screen.getByLabelText(label), { target: { files: [f] } });

describe("local image checks (26.2)", () => {
  test("signatures of PNG, JPEG and WEBP; a declared type must match the bytes", () => {
    expect(signatureMatches("image/png", new Uint8Array(PNG))).toBe(true);
    expect(signatureMatches("image/jpeg", new Uint8Array(JPEG))).toBe(true);
    expect(signatureMatches("image/webp", new Uint8Array(WEBP))).toBe(true);
    expect(signatureMatches("image/png", new Uint8Array(JPEG))).toBe(false);
    expect(signatureMatches("image/webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x51]))).toBe(false);
    expect(signatureMatches("image/svg+xml", new Uint8Array(PNG))).toBe(false);
  });

  test("type, emptiness, the 5 MiB limit (inclusive) and the signature are checked", async () => {
    expect(await validateImageFile(file(PNG, "image/png"))).toBeNull();
    expect(await validateImageFile(file(JPEG, "image/jpeg"))).toBeNull();
    expect(await validateImageFile(file(WEBP, "image/webp"))).toBeNull();
    expect(await validateImageFile(file(PNG, "image/gif"))).toMatch(/PNG, JPEG, WEBP/);
    expect(await validateImageFile(file(PNG, "image/svg+xml"))).toMatch(/PNG, JPEG, WEBP/);
    expect(await validateImageFile(file([], "image/png"))).toBe("비어 있는 파일입니다.");
    expect(await validateImageFile(file(JPEG, "image/png"))).toMatch(/맞지 않습니다/);
    const exact = new Uint8Array(MAX_IMAGE_BYTES); exact.set(PNG);
    expect(await validateImageFile(new File([exact], "a.png", { type: "image/png" }))).toBeNull();
    const over = new Uint8Array(MAX_IMAGE_BYTES + 1); over.set(PNG);
    expect(await validateImageFile(new File([over], "a.png", { type: "image/png" }))).toBe("이미지는 5 MiB 이하여야 합니다.");
  });
});

describe("page image requests (26.2)", () => {
  test("lists and fetches per scope with the bearer token in a header, never in the URL", async () => {
    const { calls } = server("TRANSLATOR", {
      "GET /api/my/episodes/7/pages": () => json(200, { items: [meta(1)] }),
      "GET /api/my/episodes/7/pages/1/image": () => imageResponse(),
      "GET /api/episodes/7/pages": () => json(200, { items: [meta(1), meta(3)] }),
    });
    expect(await listPageImages("mine", "7")).toEqual({ ok: true, value: [meta(1)] });
    expect(await listPageImages("operator", "7")).toEqual({ ok: true, value: [meta(1), meta(3)] });
    const image = await fetchPageImage("mine", "7", 1);
    expect(image.ok && image.value.type).toBe("image/png");
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(TOKEN);
      expect(call.init.credentials).toBe("omit");
      expect(call.init.cache).toBe("no-store");
    }
    expect(calls.map((call) => call.path)).toEqual(["/api/my/episodes/7/pages", "/api/episodes/7/pages", "/api/my/episodes/7/pages/1/image"]);
  });

  test("statuses map to fixed failures; no request without a token; malformed lists are refused", async () => {
    for (const [status, kind] of [[400, "invalid_request"], [403, "forbidden"], [404, "not_found"], [503, "unavailable"], [500, "server_error"]] as const) {
      server("TRANSLATOR", { "GET /api/my/episodes/7/pages/1/image": () => json(status, errorBody("X")) });
      expect(await fetchPageImage("mine", "7", 1)).toEqual({ ok: false, failure: { kind } });
    }
    server("TRANSLATOR", { "GET /api/my/episodes/7/pages/1/image": () => json(401, errorBody("AUTH_REQUIRED")) });
    expect(await fetchPageImage("mine", "7", 1)).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    server("TRANSLATOR", { "GET /api/my/episodes/7/pages/1/image": () => { throw new TypeError("offline"); } });
    expect(await fetchPageImage("mine", "7", 1)).toEqual({ ok: false, failure: { kind: "network" } });
    server("TRANSLATOR", { "GET /api/my/episodes/7/pages": () => json(200, { items: [{ pageNo: "1" }] }) });
    expect((await listPageImages("mine", "7")).ok).toBe(false);
    window.sessionStorage.clear();
    const { fn } = mockFetch(() => json(200, {}));
    expect(await fetchPageImage("mine", "7", 1)).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    expect(await uploadPageImage("7", 1, file(PNG, "image/png"))).toEqual({ ok: false, failure: { kind: "unauthorized", code: "AUTH_REQUIRED" } });
    expect(fn).not.toHaveBeenCalled();
  });

  test("an upload is a PUT whose body is the image itself with its own Content-Type; 201 is new, 200 is a replacement", async () => {
    let status = 201;
    const { calls } = server("OPERATOR", { "PUT /api/episodes/7/pages/2/image": () => json(status, meta(2)) });
    const a = await uploadPageImage("7", 2, file(JPEG, "image/jpeg", "p.jpg"));
    status = 200;
    const b = await uploadPageImage("7", 2, file(WEBP, "image/webp", "p.webp"));
    expect(a).toEqual({ ok: true, value: { meta: meta(2), created: true } });
    expect(b).toEqual({ ok: true, value: { meta: meta(2), created: false } });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].headers["Content-Type"]).toBe("image/jpeg");
    expect(calls[0].init.body).toBeInstanceOf(Blob);
    expect(calls[1].headers["Content-Type"]).toBe("image/webp");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    server("OPERATOR", { "PUT /api/episodes/7/pages/2/image": () => json(400, errorBody("INVALID_REQUEST")) });
    expect(await uploadPageImage("7", 2, file(PNG, "image/png"))).toEqual({ ok: false, failure: { kind: "invalid_request" } });
    server("OPERATOR", { "PUT /api/episodes/7/pages/2/image": () => json(404, errorBody("NOT_FOUND")) });
    expect(await uploadPageImage("7", 2, file(PNG, "image/png"))).toEqual({ ok: false, failure: { kind: "not_found" } });
  });
});

describe("PageImage (Blob URL display)", () => {
  test("shows the image from an object URL, offers original size, and releases the URL when it closes", async () => {
    server("TRANSLATOR", { "GET /api/my/episodes/7/pages/1/image": () => imageResponse() });
    const view = renderWithAuth(<PageImage scope="mine" episodeId="7" pageNo={1} />);
    const img = (await screen.findByRole("img", { name: "페이지 1 원본 이미지" })) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:test-1");
    click("원본 크기로 보기");
    expect(screen.getByRole("button", { name: "폭에 맞추기" })).toBeTruthy();
    view.unmount();
    expect(revoked).toEqual(["blob:test-1"]);
  });

  test("a late answer for a page the reader already left is dropped; the old URL is released", async () => {
    const slow = deferred<Response>();
    server("TRANSLATOR", {
      "GET /api/my/episodes/7/pages/1/image": () => slow.promise,
      "GET /api/my/episodes/7/pages/2/image": () => imageResponse(JPEG, "image/jpeg"),
    });
    const first = renderWithAuth(<PageImage scope="mine" episodeId="7" pageNo={1} />);
    first.rerender(<AuthProvider><PageImage scope="mine" episodeId="7" pageNo={2} /></AuthProvider>);
    expect(await screen.findByRole("img", { name: "페이지 2 원본 이미지" })).toBeTruthy();
    await act(async () => { slow.resolve(imageResponse()); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("img", { name: "페이지 1 원본 이미지" })).toBeNull();
    expect(created).toHaveLength(1); // the dropped answer never became an object URL
  });

  test("a changed image (new refresh key) replaces the old one and releases its URL", async () => {
    server("TRANSLATOR", { "GET /api/my/episodes/7/pages/1/image": () => imageResponse() });
    const view = renderWithAuth(<PageImage scope="mine" episodeId="7" pageNo={1} refreshKey={1} />);
    await screen.findByRole("img");
    view.rerender(<AuthProvider><PageImage scope="mine" episodeId="7" pageNo={1} refreshKey={2} /></AuthProvider>);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(revoked).toContain("blob:test-1");
  });

  test("404 says there is no image (no retry); 503 offers a retry that works; 401 signs out", async () => {
    server("TRANSLATOR", { "GET /api/my/episodes/7/pages/1/image": () => json(404, errorBody("NOT_FOUND")) });
    const a = renderWithAuth(<PageImage scope="mine" episodeId="7" pageNo={1} />);
    expect(await screen.findByText("이 페이지에는 원본 이미지가 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
    a.unmount();
    let healthy = false;
    server("TRANSLATOR", { "GET /api/my/episodes/7/pages/1/image": () => (healthy ? imageResponse() : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    const b = renderWithAuth(<PageImage scope="mine" episodeId="7" pageNo={1} />);
    expect(await screen.findByText("이미지를 불러오지 못했습니다.")).toBeTruthy();
    healthy = true;
    click("다시 시도");
    expect(await screen.findByRole("img")).toBeTruthy();
    b.unmount();
    server("TRANSLATOR", { "GET /api/my/episodes/7/pages/1/image": () => json(401, errorBody("AUTH_REQUIRED")) });
    renderWithAuth(<PageImage scope="mine" episodeId="7" pageNo={1} />);
    await waitFor(() => expect(storedToken()).toBeNull());
  });
});

describe("operator: page images panel", () => {
  async function open(routes: Record<string, H> = {}, pageNumbers = [1, 2, 3]) {
    const api = server("OPERATOR", { "GET /api/episodes/7/pages": () => json(200, { items: [meta(1, 4096)] }), "GET /api/episodes/7/pages/1/image": () => imageResponse(), ...routes });
    renderWithAuth(<PageImagesPanel episodeId="7" pageNumbers={pageNumbers} />);
    await screen.findByText(/이미지 있음 \(4 KiB\)/);
    return api;
  }

  test("lists the pages of the source: a thumbnail for pages with an image, 'no image' with an upload button for the others", async () => {
    await open();
    expect(await screen.findByRole("img", { name: "페이지 1 원본 이미지" })).toBeTruthy();
    expect(screen.getAllByText("이미지 없음")).toHaveLength(2);
    expect(screen.getByText("교체")).toBeTruthy();
    expect(screen.getAllByText("업로드")).toHaveLength(2);
  });

  test("a source without page numbers explains that no image can be uploaded", async () => {
    server("OPERATOR", { "GET /api/episodes/7/pages": () => json(200, { items: [] }) });
    renderWithAuth(<PageImagesPanel episodeId="7" pageNumbers={[]} />);
    expect(await screen.findByText(/페이지 번호가 없어 이미지를 올릴 수 없습니다/)).toBeTruthy();
  });

  test("an invalid file is refused locally and nothing is sent", async () => {
    const { calls } = await open();
    pick("페이지 2 이미지 선택", file(PNG, "image/gif", "a.gif"));
    expect(await screen.findByText("PNG, JPEG, WEBP 이미지만 올릴 수 있습니다.")).toBeTruthy();
    pick("페이지 3 이미지 선택", file(JPEG, "image/png", "fake.png"));
    expect(await screen.findByText("파일 내용이 선택한 이미지 형식과 맞지 않습니다.")).toBeTruthy();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  test("a valid file is uploaded once; the list and the thumbnail are refreshed", async () => {
    let stored = [meta(1, 4096)];
    const { calls } = await open({
      "PUT /api/episodes/7/pages/2/image": () => { stored = [...stored, meta(2, 2048)]; return json(201, meta(2)); },
      "GET /api/episodes/7/pages": () => json(200, { items: stored }),
      "GET /api/episodes/7/pages/2/image": () => imageResponse(JPEG, "image/jpeg"),
    });
    pick("페이지 2 이미지 선택", file(JPEG, "image/jpeg", "p2.jpg"));
    expect(await screen.findByText("이미지를 저장했습니다.")).toBeTruthy();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(await screen.findByRole("img", { name: "페이지 2 원본 이미지" })).toBeTruthy();
    expect(screen.getAllByText("교체")).toHaveLength(2);
  });

  test("replacing an existing image says so; server rejections and 404 show fixed messages and keep the login", async () => {
    await open({ "PUT /api/episodes/7/pages/1/image": () => json(200, meta(1)) });
    pick("페이지 1 이미지 선택", file(PNG, "image/png"));
    expect(await screen.findByText("이미지를 교체했습니다.")).toBeTruthy();
  });

  test.each([
    [400, /형식\(PNG·JPEG·WEBP\)과 크기\(5 MiB 이하\)를 확인하세요/],
    [404, /원문에 없는 페이지입니다/],
    [403, /이미지를 올릴 권한이 없습니다/],
    [503, /서비스를 사용할 수 없습니다/],
  ])("an upload answered with %s shows a fixed message", async (status, message) => {
    await open({ "PUT /api/episodes/7/pages/2/image": () => json(status, errorBody("X")) });
    pick("페이지 2 이미지 선택", file(PNG, "image/png"));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(storedToken()).not.toBeNull();
  });

  test("the file inputs are blocked while an upload runs (no duplicate upload)", async () => {
    const pending = deferred<Response>();
    const { calls } = await open({ "PUT /api/episodes/7/pages/2/image": () => pending.promise });
    pick("페이지 2 이미지 선택", file(PNG, "image/png"));
    await waitFor(() => expect((screen.getByLabelText("페이지 3 이미지 선택") as HTMLInputElement).disabled).toBe(true));
    pick("페이지 3 이미지 선택", file(PNG, "image/png"));
    await act(async () => { pending.resolve(json(201, meta(2))); });
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });
});

describe("page images in the page-by-page screens", () => {
  const blocks = [{ seq: 1, pageNo: 1, source: "원문 1", text: "가" }, { seq: 2, pageNo: 2, source: "원문 2", text: null }, { seq: 3, pageNo: null, source: "원문 3", text: null }];
  const episode = (role: string) => ({ id: "7", title: "1화", assignedRole: role, latestSourceVersion: 3, source: { version: 3, savedAt: T, blocks: [{ seq: 1, pageNo: 1, text: "원문" }] } });
  const summary = { versionNo: 2, status: "DRAFT", sourceVersion: 3, revision: 1, createdAt: T, submittedAt: null, decision: null };

  function translator(routes: Record<string, H> = {}, withPages = true) {
    const api = server("TRANSLATOR", {
      "GET /api/my/episodes/7": () => json(200, episode("TRANSLATOR")),
      "GET /api/my/episodes/7/translations": () => json(200, { latestSourceVersion: 3, items: [summary] }),
      "GET /api/my/episodes/7/translations/2": () => json(200, { ...summary, editable: true, blocks: withPages ? blocks : blocks.map((b) => ({ ...b, pageNo: null })), blockComments: [] }),
      "GET /api/my/episodes/7/pages": () => json(200, { items: [meta(1)] }),
      "GET /api/my/episodes/7/pages/1/image": () => imageResponse(),
      "GET /api/my/episodes/7/translations/2/page-images": () => json(200, { items: [] }),
      ...routes,
    });
    renderWithAuth(<AssignedDetailPage />);
    return api;
  }

  test("the translator sees the page image above the page's text, and a note on a page without one; text work is unaffected", async () => {
    translator();
    expect(await screen.findByRole("img", { name: "페이지 1 원본 이미지" })).toBeTruthy();
    expect((screen.getByLabelText("블록 1 번역") as HTMLTextAreaElement).value).toBe("가");
    click("다음 페이지");
    expect(await screen.findByText("이 페이지에는 원본 이미지가 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /원본 이미지/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("블록 2 번역"), { target: { value: "입력" } });
    click("다음 페이지");
    expect(screen.getByLabelText("블록 3 번역")).toBeTruthy(); // the page without a number has no image area at all
    expect(screen.queryByText("이 페이지에는 원본 이미지가 없습니다.")).toBeNull();
  });

  test("when the image list cannot be loaded the text work continues and a retry is offered", async () => {
    let healthy = false;
    translator({ "GET /api/my/episodes/7/pages": () => (healthy ? json(200, { items: [meta(1)] }) : json(503, errorBody("SERVICE_UNAVAILABLE"))) });
    expect(await screen.findByText(/페이지 이미지를 불러오지 못했습니다. 텍스트 작업은 계속할 수 있습니다/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("블록 1 번역"), { target: { value: "계속 입력" } });
    healthy = true;
    click("다시 시도");
    expect(await screen.findByRole("img", { name: "페이지 1 원본 이미지" })).toBeTruthy();
    expect((screen.getByLabelText("블록 1 번역") as HTMLTextAreaElement).value).toBe("계속 입력");
  });

  test("a version without page numbers never asks for images", async () => {
    const { calls } = translator({}, false);
    await screen.findByLabelText("블록 1 번역");
    expect(calls.some((call) => call.path.includes("/pages"))).toBe(false);
  });

  test("the reviewer sees the image on the review page and uses only the reviewer's own image paths", async () => {
    const { calls } = server("REVIEWER", {
      "GET /api/my/episodes/7/reviews/2": () => json(200, { versionNo: 2, status: "REVIEW_PENDING", sourceVersion: 3, submittedAt: T, decidable: true, decision: null, blocks, blockComments: [] }),
      "GET /api/my/episodes/7/pages": () => json(200, { items: [meta(1)] }),
      "GET /api/my/episodes/7/pages/1/image": () => imageResponse(),
    });
    renderWithAuth(<ReviewDetailPage />);
    expect(await screen.findByRole("img", { name: "페이지 1 원본 이미지" })).toBeTruthy();
    expect(calls.filter((call) => call.path.includes("/pages")).every((call) => call.path.startsWith("/api/my/episodes/7/pages"))).toBe(true);
  });
});
