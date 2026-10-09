"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GENRES, type ReadingDirection } from "@/lib/catalog/types";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";
import { validateImageFile } from "@/lib/pages/validation";
import { createWork, fetchAdminCover, getAdminWork, listAdminWorks, updateWork, uploadWorkCover } from "@/lib/works/client";
import { coverUploadMessage, workFailureMessage } from "@/lib/works/messages";
import { MAX_GENRES, type AdminWork, type AdminWorkDetail, type WorkInput } from "@/lib/works/types";
import { normalizeWork, validateWork, type WorkErrors } from "@/lib/works/validation";

const PAGE_SIZE = 20;
const DIRECTION_LABEL: Record<ReadingDirection, string> = { RTL: "오른쪽→왼쪽 (일본 만화)", LTR: "왼쪽→오른쪽" };

const emptyInput = (): WorkInput => ({ title: "", author: "", description: "", readingDirection: "RTL", genres: [], isPublic: false, isFeatured: false, isBanner: false });
const inputOf = (work: AdminWorkDetail): WorkInput => ({
  title: work.title, author: work.author, description: work.description, readingDirection: work.readingDirection, genres: work.genres,
  isPublic: work.isPublic, isFeatured: work.isFeatured, isBanner: work.isBanner,
});
const sameInput = (a: WorkInput, b: WorkInput) => JSON.stringify(normalizeWork(a)) === JSON.stringify(normalizeWork(b));

/** At most three genres: once three are picked the others cannot be added. */
function GenrePicker({ value, onChange, error, idPrefix }: { value: string[]; onChange: (genres: string[]) => void; error?: string; idPrefix: string }) {
  return <fieldset className="mb-3" aria-describedby={error ? `${idPrefix}-genres-error` : undefined}>
    <legend className="form-label">장르 (1~{MAX_GENRES}개)</legend>
    <div className="d-flex flex-wrap gap-3">
      {GENRES.map((genre) => {
        const checked = value.includes(genre);
        return <div className="form-check" key={genre}>
          <input id={`${idPrefix}-genre-${genre}`} type="checkbox" className="form-check-input" checked={checked} disabled={!checked && value.length >= MAX_GENRES}
            onChange={(event) => onChange(event.target.checked ? [...value, genre] : value.filter((item) => item !== genre))} />
          <label className="form-check-label" htmlFor={`${idPrefix}-genre-${genre}`}>{genre}</label>
        </div>;
      })}
    </div>
    {error && <p id={`${idPrefix}-genres-error`} className="text-danger small mt-1 mb-0" role="alert">{error}</p>}
  </fieldset>;
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return <div className="mb-3">
    <label className="form-label" htmlFor={id}>{label}</label>
    {children}
    {error && <p className="text-danger small mt-1 mb-0" role="alert">{error}</p>}
  </div>;
}

function DescriptiveFields({ value, onChange, errors, idPrefix }: { value: WorkInput; onChange: (next: WorkInput) => void; errors: WorkErrors; idPrefix: string }) {
  return <>
    <Field id={`${idPrefix}-title`} label="제목" error={errors.title}>
      <input id={`${idPrefix}-title`} className="form-control" value={value.title} aria-invalid={errors.title ? true : undefined} onChange={(event) => onChange({ ...value, title: event.target.value })} />
    </Field>
    <Field id={`${idPrefix}-author`} label="작가" error={errors.author}>
      <input id={`${idPrefix}-author`} className="form-control" value={value.author} aria-invalid={errors.author ? true : undefined} onChange={(event) => onChange({ ...value, author: event.target.value })} />
    </Field>
    <Field id={`${idPrefix}-description`} label="소개" error={errors.description}>
      <textarea id={`${idPrefix}-description`} className="form-control" rows={4} value={value.description} aria-invalid={errors.description ? true : undefined}
        onChange={(event) => onChange({ ...value, description: event.target.value })} />
    </Field>
    <Field id={`${idPrefix}-direction`} label="읽기 방향">
      <select id={`${idPrefix}-direction`} className="form-select w-auto" value={value.readingDirection} onChange={(event) => onChange({ ...value, readingDirection: event.target.value as ReadingDirection })}>
        <option value="RTL">{DIRECTION_LABEL.RTL}</option>
        <option value="LTR">{DIRECTION_LABEL.LTR}</option>
      </select>
    </Field>
    <GenrePicker value={value.genres} onChange={(genres) => onChange({ ...value, genres })} error={errors.genres} idPrefix={idPrefix} />
  </>;
}

/** The operator's works: the list and a form to create one (CONTRACTS 28.6). */
export function WorkAdminList() {
  const router = useRouter();
  const { handleUnauthorized } = useAuth();
  const [items, setItems] = useState<AdminWork[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<EpisodeFailure | null>(null);
  const [form, setForm] = useState<WorkInput>(emptyInput);
  const [errors, setErrors] = useState<WorkErrors>({});
  const [creating, setCreating] = useState(false);
  const [createFailure, setCreateFailure] = useState<EpisodeFailure | null>(null);
  const active = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async (nextOffset: number) => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const result = await listAdminWorks(PAGE_SIZE, nextOffset, request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setItems(result.value.items); setTotal(result.value.total); setOffset(nextOffset); setFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setFailure(result.failure);
  }, [handleUnauthorized]);

  useEffect(() => {
    void load(0);
    return () => active.current?.abort();
  }, [load]);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    const found = validateWork(form);
    setErrors(found);
    setCreateFailure(null);
    if (Object.keys(found).length > 0) return;
    busyRef.current = true;
    setCreating(true);
    const result = await createWork(normalizeWork(form));
    busyRef.current = false;
    setCreating(false);
    if (result.ok) { router.push(`/works-admin/${encodeURIComponent(result.value.id)}`); return; }
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setCreateFailure(result.failure);
  }

  return <>
    <section aria-label="새 작품" className="card card-body shadow-sm mb-4">
      <h2 className="h5">새 작품 만들기</h2>
      <p className="text-secondary small">만든 작품은 비공개로 시작합니다. 표지·공개·추천·배너는 작품 화면에서 설정합니다.</p>
      <form onSubmit={(event) => void onCreate(event)} noValidate>
        <DescriptiveFields value={form} onChange={setForm} errors={errors} idPrefix="new-work" />
        {createFailure && <p className="alert alert-danger" role="alert">{workFailureMessage(createFailure)}</p>}
        <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? "만드는 중…" : "작품 만들기"}</button>
      </form>
    </section>

    <section aria-label="작품 목록">
      <h2 className="h5">작품 목록</h2>
      {loading && items === null && <p role="status">불러오는 중…</p>}
      {failure && <div className="alert alert-warning" role="alert">
        <p>{episodeFailureMessage(failure)}</p>
        <button type="button" className="btn btn-primary" onClick={() => void load(offset)}>다시 시도</button>
      </div>}
      {items !== null && items.length === 0 && <p className="text-secondary empty-note">아직 작품이 없습니다.</p>}
      {items !== null && items.length > 0 && <div className="table-responsive"><table className="table align-middle">
        <thead><tr><th>작품</th><th>장르</th><th>상태</th><th>회차</th><th><span className="visually-hidden">동작</span></th></tr></thead>
        <tbody>
          {items.map((work) => <tr key={work.id}>
            <td><strong>{work.title}</strong><div className="small text-secondary">{work.author}</div></td>
            <td>{work.genres.join(", ")}</td>
            <td>
              <span className={`badge ${work.isPublic ? "text-bg-success" : "text-bg-secondary"} me-1`}>{work.isPublic ? "공개" : "비공개"}</span>
              {work.isFeatured && <span className="badge text-bg-info me-1">추천</span>}
              {work.isBanner && <span className="badge text-bg-primary me-1">배너</span>}
              {!work.hasCover && <span className="badge text-bg-warning">표지 없음</span>}
            </td>
            <td>{work.publicEpisodeCount} / {work.episodeCount}</td>
            <td><Link href={`/works-admin/${encodeURIComponent(work.id)}`} className="btn btn-outline-secondary btn-sm">{work.title} 편집</Link></td>
          </tr>)}
        </tbody>
      </table></div>}
      {total > PAGE_SIZE && <div className="d-flex gap-2 align-items-center">
        <button type="button" className="btn btn-outline-secondary" disabled={loading || offset === 0} onClick={() => void load(Math.max(offset - PAGE_SIZE, 0))}>이전</button>
        <span className="small text-secondary">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}</span>
        <button type="button" className="btn btn-outline-secondary" disabled={loading || offset + PAGE_SIZE >= total} onClick={() => void load(offset + PAGE_SIZE)}>다음</button>
      </div>}
    </section>
  </>;
}

/** The operator's own view of the cover (it needs the login header, so it is shown from a Blob URL that is released again). */
function CoverPreview({ workId, refreshKey }: { workId: string; refreshKey: string }) {
  const { handleUnauthorized } = useAuth();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "none" } | { kind: "failed" } | { kind: "ready"; url: string }>({ kind: "loading" });
  const urlRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    setState({ kind: "loading" });
    void fetchAdminCover(workId, request.signal).then((result) => {
      if (request.signal.aborted) return;
      if (!result.ok) {
        if (result.failure.kind === "aborted") return;
        if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
        setState({ kind: result.failure.kind === "not_found" ? "none" : "failed" });
        return;
      }
      const url = URL.createObjectURL(result.value);
      urlRef.current = url;
      setState({ kind: "ready", url });
    });
    return () => {
      request.abort();
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [workId, refreshKey, attempt, handleUnauthorized]);

  if (state.kind === "loading") return <p role="status" className="small text-secondary">표지를 불러오는 중…</p>;
  if (state.kind === "none") return <p className="small text-secondary border rounded p-2">표지가 없습니다.</p>;
  if (state.kind === "failed") {
    return <div className="small text-secondary border rounded p-2"><span>표지를 불러오지 못했습니다.</span>
      <button type="button" className="btn btn-link btn-sm" onClick={() => setAttempt((count) => count + 1)}>다시 시도</button></div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a Blob URL cannot go through next/image
    <img src={state.url} alt="현재 표지" className="cover-img rounded" style={{ maxWidth: "12rem" }} />
  );
}

/** Edit one work: basic data, flags, cover and the linked episodes (CONTRACTS 28.6). */
export function WorkAdminEditor({ workId }: { workId: string }) {
  const { handleUnauthorized } = useAuth();
  const [work, setWork] = useState<AdminWorkDetail | null>(null);
  const [form, setForm] = useState<WorkInput>(emptyInput);
  const [errors, setErrors] = useState<WorkErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<EpisodeFailure | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "danger" | "warning"; text: string } | null>(null);
  const [stale, setStale] = useState(false); // another change happened: the form stays until the operator reloads
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverMessage, setCoverMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [coverKey, setCoverKey] = useState("0");
  const active = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setLoading(true);
    const result = await getAdminWork(workId, request.signal);
    if (active.current !== request) return;
    active.current = null;
    setLoading(false);
    if (result.ok) { setWork(result.value); setForm(inputOf(result.value)); setErrors({}); setStale(false); setLoadFailure(null); return; }
    if (result.failure.kind === "aborted") return;
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setLoadFailure(result.failure);
  }, [workId, handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    if (!work || busyRef.current) return;
    const found = validateWork(form);
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length > 0) return;
    busyRef.current = true;
    setBusy(true);
    const result = await updateWork(work.id, work.revision, normalizeWork(form));
    busyRef.current = false;
    setBusy(false);
    if (result.ok) {
      setNotice({ tone: result.value.changed ? "success" : "info", text: result.value.changed ? "저장했습니다." : "변경 사항이 없습니다." });
      await load();
      return;
    }
    if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
    if (result.failure.kind === "revision_conflict") setStale(true);
    setNotice({ tone: result.failure.kind === "revision_conflict" ? "warning" : "danger", text: workFailureMessage(result.failure) });
  }

  async function onCover(files: FileList | null) {
    const chosen = files?.[0];
    if (!chosen || !work || coverBusy) return;
    setCoverMessage(null);
    const problem = await validateImageFile(chosen);
    if (problem) { setCoverMessage({ tone: "danger", text: problem }); return; }
    setCoverBusy(true);
    const result = await uploadWorkCover(work.id, chosen);
    setCoverBusy(false);
    if (!result.ok) {
      if (result.failure.kind === "unauthorized") { handleUnauthorized(); return; }
      setCoverMessage({ tone: "danger", text: coverUploadMessage(result.failure) });
      return;
    }
    setCoverMessage({ tone: "success", text: result.value.created ? "표지를 올렸습니다." : "표지를 교체했습니다." });
    setCoverKey(String(Date.now()));
    // the work now has a cover; the revision is untouched by a cover upload, so only the flag is refreshed
    setWork({ ...work, hasCover: true });
  }

  if (loading && !work) return <p role="status">불러오는 중…</p>;
  if (loadFailure && !work) {
    return <div className="alert alert-warning" role="alert">
      <p>{loadFailure.kind === "not_found" ? "작품을 찾을 수 없습니다." : workFailureMessage(loadFailure)}</p>
      {loadFailure.kind === "not_found"
        ? <Link href="/works-admin" className="btn btn-outline-secondary">작품 목록으로</Link>
        : <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>}
    </div>;
  }
  if (!work) return null;
  const dirty = !sameInput(form, inputOf(work));

  return <>
    <p><Link href="/works-admin">← 작품 목록</Link></p>
    <h1 className="h2 mb-1">{work.title}</h1>
    <p className="text-secondary">revision {work.revision} · {work.publicEpisodeCount}/{work.episodeCount}개 회차 공개 중</p>
    {notice && <p className={`alert alert-${notice.tone}`} role={notice.tone === "danger" || notice.tone === "warning" ? "alert" : "status"}>{notice.text}</p>}
    {stale && <div className="mb-3">
      <button type="button" className="btn btn-warning" disabled={loading} onClick={() => { setNotice(null); void load(); }}>최신 내용 불러오기 (입력 중인 내용은 사라집니다)</button>
    </div>}

    <section aria-label="표지" className="card card-body shadow-sm mb-3">
      <h2 className="h5">표지</h2>
      <CoverPreview workId={work.id} refreshKey={coverKey} />
      <label className="form-label small mt-2 mb-1" htmlFor="work-cover-upload">표지 {work.hasCover ? "교체" : "올리기"}</label>
      <input id="work-cover-upload" type="file" accept="image/png,image/jpeg,image/webp" className="form-control form-control-sm" disabled={coverBusy}
        onChange={(event) => { const input = event.currentTarget; void onCover(input.files).finally(() => { input.value = ""; }); }} />
      <p className="small text-secondary mb-1">PNG·JPEG·WEBP, 5 MiB 이하. 표지는 즉시 저장됩니다.</p>
      {coverBusy && <p role="status" className="small mb-1">올리는 중…</p>}
      {coverMessage && <p role={coverMessage.tone === "danger" ? "alert" : "status"} className={`small mb-1 ${coverMessage.tone === "danger" ? "text-danger" : "text-success"}`}>{coverMessage.text}</p>}
    </section>

    <form onSubmit={(event) => void onSave(event)} noValidate aria-label="작품 정보" className="card card-body shadow-sm mb-3">
      <h2 className="h5">기본 정보와 노출</h2>
      <DescriptiveFields value={form} onChange={setForm} errors={errors} idPrefix="edit-work" />
      <fieldset className="mb-3">
        <legend className="form-label">노출</legend>
        <div className="form-check">
          <input id="work-public" type="checkbox" className="form-check-input" checked={form.isPublic} onChange={(event) => setForm({ ...form, isPublic: event.target.checked })} />
          <label className="form-check-label" htmlFor="work-public">공개 (공개된 회차가 1개 이상일 때 독자에게 보입니다)</label>
        </div>
        <div className="form-check">
          <input id="work-featured" type="checkbox" className="form-check-input" checked={form.isFeatured} onChange={(event) => setForm({ ...form, isFeatured: event.target.checked })} />
          <label className="form-check-label" htmlFor="work-featured">운영자 추천</label>
        </div>
        <div className="form-check">
          <input id="work-banner" type="checkbox" className="form-check-input" checked={form.isBanner} disabled={!work.hasCover && !form.isBanner}
            onChange={(event) => setForm({ ...form, isBanner: event.target.checked })} />
          <label className="form-check-label" htmlFor="work-banner">메인 배너 (지금은 메인 화면에 표시되지 않습니다. 표지가 있어야 하고 동시에 5개까지)</label>
        </div>
      </fieldset>
      <div className="d-flex gap-2 align-items-center flex-wrap">
        <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>{busy ? "저장 중…" : "저장"}</button>
        {dirty && <span className="small text-secondary">저장하지 않은 변경이 있습니다.</span>}
      </div>
    </form>

    <section aria-label="연결된 회차" className="card card-body shadow-sm">
      <h2 className="h5">연결된 회차</h2>
      <p className="text-secondary small">회차를 작품에 연결하는 곳은 각 회차 화면의 "작품 연결"입니다.</p>
      {work.episodes.length === 0 && <p className="text-secondary empty-note">연결된 회차가 없습니다.</p>}
      {work.episodes.length > 0 && <ul className="list-group">
        {work.episodes.map((episode) => <li key={episode.episodeId} className="list-group-item d-flex justify-content-between align-items-center">
          <Link href={`/episodes/${encodeURIComponent(episode.episodeId)}`}>{episode.episodeNo}화 · {episode.title}</Link>
          <span className={`badge ${episode.published ? "text-bg-success" : "text-bg-secondary"}`}>{episode.published ? "공개 중" : "미공개"}</span>
        </li>)}
      </ul>}
    </section>
  </>;
}
