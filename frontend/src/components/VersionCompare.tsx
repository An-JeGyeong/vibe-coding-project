"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeResult } from "@/lib/episodes/types";
import { compareBlocks, summarizeCompare, type CompareBlock, type CompareRow } from "@/lib/translation/compare";
import type { BlockComment } from "@/lib/translation/comments";
import { STATUS_LABEL, type TranslationStatus } from "@/lib/translation/types";

export type CompareDetail = { versionNo: number; sourceVersion: number; blocks: CompareBlock[]; blockComments: BlockComment[] };
type Loader = (versionNo: number, signal?: AbortSignal) => Promise<EpisodeResult<CompareDetail>>;
type Result = { older: CompareDetail; newer: CompareDetail; rows: CompareRow[] };

/** Default pair: the latest rejected version and the version right after it, else the two newest versions (CONTRACTS 23.1). */
export function defaultPair(versions: { versionNo: number; status: string }[]): [number, number] | null {
  const ascending = [...versions].sort((a, b) => a.versionNo - b.versionNo);
  if (ascending.length < 2) return null;
  for (let index = ascending.length - 2; index >= 0; index--) {
    if (ascending[index].status === "REJECTED") return [ascending[index].versionNo, ascending[index + 1].versionNo];
  }
  return [ascending[ascending.length - 2].versionNo, ascending[ascending.length - 1].versionNo];
}

const CHANGE_LABEL = { same: "같음", changed: "변경됨", added: "추가됨", removed: "삭제됨" } as const;
const CHANGE_TONE = { same: "secondary", changed: "warning", added: "success", removed: "danger" } as const;

/** Block-level comparison of two versions. Each role passes its own existing detail API as `load` (CONTRACTS 23.1). */
export function VersionCompare({ versions, load }: { versions: { versionNo: number; status: string }[]; load: Loader }) {
  const { handleUnauthorized } = useAuth();
  const pair = defaultPair(versions);
  const [older, setOlder] = useState(String(pair?.[0] ?? ""));
  const [newer, setNewer] = useState(String(pair?.[1] ?? ""));
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const ticket = useRef(0);

  if (!pair) return null;

  async function compare() {
    const a = Number(older);
    const b = Number(newer);
    setResult(null);
    if (a === b) { setError("서로 다른 두 버전을 선택하세요."); return; }
    const mine = ++ticket.current;
    setError(null);
    setLoading(true);
    const [first, second] = await Promise.all([load(a), load(b)]);
    if (mine !== ticket.current) return; // a newer comparison wins
    setLoading(false);
    for (const loaded of [first, second]) {
      if (!loaded.ok) {
        if (loaded.failure.kind === "unauthorized") { handleUnauthorized(); return; }
        setError(episodeFailureMessage(loaded.failure)); // never a half result
        return;
      }
    }
    if (!first.ok || !second.ok) return;
    setResult({ older: first.value, newer: second.value, rows: compareBlocks(first.value.blocks, second.value.blocks) });
  }

  const summary = result ? summarizeCompare(result.rows) : null;
  const rows = result ? result.rows.filter((row) => !onlyChanged || row.change !== "same") : [];
  const label = (versionNo: number) => {
    const found = versions.find((version) => version.versionNo === versionNo);
    return `v${versionNo}${found ? ` (${STATUS_LABEL[found.status as TranslationStatus] ?? found.status})` : ""}`;
  };
  const ordered = [...versions].sort((a, b) => b.versionNo - a.versionNo);

  return <section aria-label="버전 비교" className="card card-body shadow-sm mb-3">
    <h2 className="h5">버전 비교</h2>
    <div className="d-flex flex-wrap gap-2 align-items-end mb-2">
      <div>
        <label className="form-label small mb-1" htmlFor="compare-older">이전 버전</label>
        <select id="compare-older" className="form-select form-select-sm" value={older} onChange={(event) => setOlder(event.target.value)}>
          {ordered.map((version) => <option key={version.versionNo} value={version.versionNo}>{label(version.versionNo)}</option>)}
        </select>
      </div>
      <div>
        <label className="form-label small mb-1" htmlFor="compare-newer">새 버전</label>
        <select id="compare-newer" className="form-select form-select-sm" value={newer} onChange={(event) => setNewer(event.target.value)}>
          {ordered.map((version) => <option key={version.versionNo} value={version.versionNo}>{label(version.versionNo)}</option>)}
        </select>
      </div>
      <button type="button" className="btn btn-outline-primary btn-sm" disabled={loading} onClick={() => void compare()}>{loading ? "비교하는 중…" : "비교"}</button>
    </div>
    {error && <div className="alert alert-warning py-2" role="alert">
      <span>{error}</span>
      {error !== "서로 다른 두 버전을 선택하세요." && <button type="button" className="btn btn-link btn-sm" onClick={() => void compare()}>다시 시도</button>}
    </div>}
    {result && summary && <>
      <p className="small mb-1">변경 {summary.changed} · 추가 {summary.added} · 삭제 {summary.removed} · 같음 {summary.same}</p>
      {result.older.sourceVersion !== result.newer.sourceVersion && <p className="text-warning-emphasis small mb-1">기준 원문이 다릅니다(v{result.older.sourceVersion} / v{result.newer.sourceVersion}).</p>}
      <div className="form-check mb-2">
        <input id="compare-only-changed" type="checkbox" className="form-check-input" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} />
        <label className="form-check-label small" htmlFor="compare-only-changed">변경된 블록만 보기</label>
      </div>
      {rows.length === 0 && <p className="text-secondary small">표시할 블록이 없습니다.</p>}
      <ol className="list-unstyled mb-0">
        {rows.map((row) => {
          const remark = result.older.blockComments.find((comment) => comment.seq === row.seq);
          return <li key={row.seq} className="border rounded p-2 mb-2">
            <div className="mb-1">
              <span className="badge text-bg-secondary me-2">블록 {row.seq}</span>
              <span className={`badge text-bg-${CHANGE_TONE[row.change]}`}>{CHANGE_LABEL[row.change]}</span>
            </div>
            <div className="row g-2">
              <div className="col-md-6" style={{ whiteSpace: "pre-wrap" }}>{row.before === null ? <span className="text-secondary">(없음)</span> : row.before === "" ? <span className="text-secondary">(번역 없음)</span> : row.before}</div>
              <div className="col-md-6" style={{ whiteSpace: "pre-wrap" }}>{row.after === null ? <span className="text-secondary">(없음)</span> : row.after === "" ? <span className="text-secondary">(번역 없음)</span> : row.after}</div>
            </div>
            {remark && <div className="alert alert-warning py-1 px-2 mt-2 mb-0 small" style={{ whiteSpace: "pre-wrap" }}>이전 버전 감수 의견: {remark.text}</div>}
          </li>;
        })}
      </ol>
    </>}
  </section>;
}
