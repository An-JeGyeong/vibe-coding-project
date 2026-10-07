"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getAssignments, listAssignableAccounts, setAssignment } from "@/lib/assignment/client";
import { ASSIGNEE_LABEL, SLOT_ROLE, type AssignableAccount, type Assignments, type SlotKey } from "@/lib/assignment/types";
import { episodeFailureMessage } from "@/lib/episodes/messages";
import type { EpisodeFailure } from "@/lib/episodes/types";

type Notice = { tone: "success" | "info" | "danger"; text: string };
const SLOTS: SlotKey[] = ["translator", "reviewer"];

// Operator-only area of the episode detail page (the gate above it decides whether it is mounted at all).
export function AssignmentPanel({ episodeId }: { episodeId: string }) {
  const { handleUnauthorized } = useAuth();
  const [assignments, setAssignments] = useState<Assignments | null>(null);
  const [candidates, setCandidates] = useState<Record<SlotKey, AssignableAccount[]>>({ translator: [], reviewer: [] });
  const [selected, setSelected] = useState<Record<SlotKey, string>>({ translator: "", reviewer: "" });
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<EpisodeFailure | null>(null);
  const [saving, setSaving] = useState<SlotKey | null>(null);
  const [notices, setNotices] = useState<Partial<Record<SlotKey, Notice>>>({});
  const savingRef = useRef(false);
  const activeLoad = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    activeLoad.current?.abort();
    const request = new AbortController();
    activeLoad.current = request;
    setLoading(true);
    const [current, translators, reviewers] = await Promise.all([
      getAssignments(episodeId, request.signal),
      listAssignableAccounts("TRANSLATOR", request.signal),
      listAssignableAccounts("REVIEWER", request.signal),
    ]);
    if (activeLoad.current !== request) return; // superseded or unmounted
    activeLoad.current = null;
    setLoading(false);
    const failed = !current.ok ? current.failure : !translators.ok ? translators.failure : !reviewers.ok ? reviewers.failure : null;
    if (failed) {
      if (failed.kind === "aborted") return;
      if (failed.kind === "unauthorized") { handleUnauthorized(); return; }
      setLoadFailure(failed);
      return;
    }
    if (!current.ok || !translators.ok || !reviewers.ok) return;
    setLoadFailure(null);
    setAssignments(current.value);
    setCandidates({ translator: translators.value, reviewer: reviewers.value });
    setSelected({ translator: current.value.translator?.account.id ?? "", reviewer: current.value.reviewer?.account.id ?? "" });
  }, [episodeId, handleUnauthorized]);

  useEffect(() => {
    void load();
    return () => activeLoad.current?.abort();
  }, [load]);

  async function onAssign(slot: SlotKey) {
    if (savingRef.current || !assignments || selected[slot] === "") return;
    savingRef.current = true;
    setSaving(slot);
    setNotices((previous) => ({ ...previous, [slot]: undefined }));
    const result = await setAssignment(episodeId, slot, selected[slot]);
    savingRef.current = false;
    setSaving(null);
    if (result.ok) {
      const { person, changed, created } = result.value;
      setAssignments((previous) => (previous ? { ...previous, [slot]: person } : previous));
      const label = ASSIGNEE_LABEL[SLOT_ROLE[slot]];
      setNotices((previous) => ({ ...previous, [slot]: changed
        ? { tone: "success", text: `${label}를 ${person.account.displayName}(으)로 ${created ? "배정" : "교체"}했습니다.` }
        : { tone: "info", text: "이미 같은 담당자입니다. 변경 사항이 없습니다." } }));
      return;
    }
    const { failure } = result;
    if (failure.kind === "unauthorized") { handleUnauthorized(); return; }
    setNotices((previous) => ({ ...previous, [slot]: { tone: "danger", text: failure.kind === "invalid_request"
      ? "선택한 계정을 배정할 수 없습니다. 후보 목록을 새로 불러오세요."
      : episodeFailureMessage(failure) } }));
  }

  return <section id="section-assignment" aria-label="담당자 배정" className="card card-body shadow-sm mb-3">
    <h2 className="h5">담당자 배정</h2>
    <p className="text-secondary small">회차마다 번역가·감수자를 한 명씩 지정합니다. 교체하면 이전 담당자는 즉시 이 회차를 볼 수 없습니다.</p>
    {loading && !assignments && <p role="status">불러오는 중…</p>}
    {loadFailure && <div className="alert alert-warning" role="alert">
      <p>{episodeFailureMessage(loadFailure)}</p>
      <button type="button" className="btn btn-primary" onClick={() => void load()}>다시 시도</button>
    </div>}
    {assignments && SLOTS.map((slot) => {
      const label = ASSIGNEE_LABEL[SLOT_ROLE[slot]];
      const current = assignments[slot];
      const notice = notices[slot];
      const unchanged = selected[slot] === (current?.account.id ?? "");
      return <div key={slot} className="border rounded p-2 mb-2">
        <p className="mb-1"><strong>{label}</strong>: {current
          ? <>{current.account.displayName} <span className="text-secondary small">(배정 <time>{current.assignedAt}</time>)</span></>
          : <span className="text-secondary">미배정</span>}</p>
        <div className="d-flex gap-2 align-items-end flex-wrap">
          <div className="flex-grow-1">
            <label className="form-label small mb-1" htmlFor={`assign-${slot}`}>{label} 후보</label>
            <select id={`assign-${slot}`} className="form-select" value={selected[slot]}
              onChange={(event) => setSelected((previous) => ({ ...previous, [slot]: event.target.value }))}>
              <option value="">선택하세요</option>
              {candidates[slot].map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-primary" disabled={saving !== null || selected[slot] === "" || unchanged}
            onClick={() => void onAssign(slot)}>{saving === slot ? "저장 중…" : `${label} ${current ? "교체" : "배정"}`}</button>
        </div>
        {candidates[slot].length === 0 && <p className="text-secondary small mt-1 mb-0">배정할 수 있는 {label} 계정이 없습니다.</p>}
        {notice && <p className={`alert alert-${notice.tone} mt-2 mb-0`} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</p>}
      </div>;
    })}
  </section>;
}
