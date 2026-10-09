"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicEpisode } from "@/lib/publication/types";
import { buildUnits, type Direction, stepForKey, stepForSide, stepForSwipe, type Step, unitIndexOf, type ViewMode } from "@/lib/viewer/navigation";
import { loadSettings, loadViewerPosition, saveSettings, saveViewerPosition, type ViewerSettings } from "@/lib/viewer/storage";
import { publicImageUrl } from "@/lib/viewer/client";

const WIDE_MIN = 992; // a two-page spread needs a wide screen
const PRELOAD_AHEAD = 2;

function useWide() {
  const [wide, setWide] = useState(() => (typeof window === "undefined" ? true : window.innerWidth >= WIDE_MIN));
  useEffect(() => {
    const update = () => setWide(window.innerWidth >= WIDE_MIN);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return wide;
}

/** One page image straight from the public API. A failure is shown for this page only; the others keep working. */
function ViewerImage({ episodeId, pageNo, scroll }: { episodeId: string; pageNo: number; scroll: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed) {
    return <div className="viewer-failed" role="group" aria-label={`페이지 ${pageNo}`}>
      <p className="mb-2">이미지를 불러오지 못했습니다.</p>
      <button type="button" className="btn btn-outline-light btn-sm" onClick={() => { setFailed(false); setLoaded(false); setAttempt((count) => count + 1); }}>다시 시도</button>
    </div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a public image from another origin, shown as is
    <img className={scroll ? "viewer-img-scroll" : "viewer-img"} src={publicImageUrl(episodeId, pageNo, attempt)} alt={`페이지 ${pageNo}`}
      loading={scroll ? "lazy" : undefined} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
      // a not-yet-loaded image has no height; without a placeholder every lazy image would sit at zero height and none would ever load
      style={scroll && !loaded ? { minHeight: "60vh" } : undefined} />
  );
}

function Choice<T extends string | boolean>({ name, legend, value, options, onChange, disabledNote }: {
  name: string; legend: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabledNote?: string;
}) {
  return <fieldset className="mb-3" disabled={!!disabledNote}>
    <legend className="h6">{legend}</legend>
    {options.map((option) => <div className="form-check" key={String(option.value)}>
      <input className="form-check-input" type="radio" name={name} id={`${name}-${String(option.value)}`} checked={value === option.value} onChange={() => onChange(option.value)} />
      <label className="form-check-label" htmlFor={`${name}-${String(option.value)}`}>{option.label}</label>
    </div>)}
    {disabledNote && <p className="small text-secondary mb-0">{disabledNote}</p>}
  </fieldset>;
}

function SettingsPanel({ settings, wide, onChange, onClose }: { settings: ViewerSettings; wide: boolean; onChange: (next: ViewerSettings) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input:not(:disabled), button")?.focus();
    return () => opener?.focus?.();
  }, []);
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
    if (event.key !== "Tab") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? []);
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div ref={ref} role="dialog" aria-modal="true" aria-label="뷰어 설정" className="viewer-settings card card-body shadow" onKeyDown={onKeyDown}>
    <Choice<ViewMode> name="vmode" legend="보기 방식" value={settings.mode} onChange={(mode) => onChange({ ...settings, mode })}
      options={[{ value: "page", label: "페이지 넘김" }, { value: "scroll", label: "스크롤" }]} />
    <Choice<boolean> name="vspread" legend="쪽 수" value={settings.spread} onChange={(spread) => onChange({ ...settings, spread })}
      options={[{ value: false, label: "한 쪽" }, { value: true, label: "두 쪽 펼침" }]}
      disabledNote={settings.mode === "scroll" ? "스크롤 방식에서는 쓰지 않습니다." : !wide ? "두 쪽 펼침은 넓은 화면에서만 쓸 수 있습니다." : undefined} />
    <Choice<Direction> name="vdir" legend="읽기 방향" value={settings.direction} onChange={(direction) => onChange({ ...settings, direction })}
      options={[{ value: "rtl", label: "오른쪽→왼쪽 (일본 만화)" }, { value: "ltr", label: "왼쪽→오른쪽" }]} />
    <button type="button" className="btn btn-primary" onClick={onClose}>닫기</button>
  </div>;
}

export function MangaViewer({ episodeId, title, publishedAt, pages, previous, next, listHref = "/read", defaultDirection }: {
  episodeId: string; title: string; publishedAt: string; pages: number[]; previous: PublicEpisode | null; next: PublicEpisode | null;
  /** Where the "목록" link goes: the work page when the episode belongs to a work. */
  listHref?: string;
  /** The work's reading direction; used only while the reader has not chosen one. */
  defaultDirection?: Direction;
}) {
  const [settings, setSettings] = useState<ViewerSettings>(() => loadSettings(defaultDirection));
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const [pageNo, setPageNo] = useState(() => {
    const saved = loadViewerPosition(episodeId, publishedAt);
    return saved !== null && pages.includes(saved) ? saved : pages[0];
  });
  const touch = useRef<{ x: number; y: number } | null>(null);

  const paged = settings.mode === "page";
  const spread = paged && settings.spread && wide;
  const units = useMemo(() => buildUnits(pages, spread), [pages, spread]);
  const index = unitIndexOf(units, pageNo);
  const unit = units[index];
  const direction = settings.direction;

  const change = (value: ViewerSettings) => { setSettings(value); saveSettings(value); };
  const go = useCallback((step: Step) => {
    const target = units[index + step];
    if (target) setPageNo(target[0]);
  }, [units, index]);

  useEffect(() => { if (paged) saveViewerPosition(episodeId, unit[0], publishedAt); }, [paged, episodeId, unit, publishedAt]);

  useEffect(() => {
    if (!paged) return;
    // the next pages are fetched ahead so turning a page does not wait; failures are handled when the page itself is shown
    for (let offset = -1; offset <= PRELOAD_AHEAD; offset++) {
      for (const page of units[index + offset] ?? []) if (typeof Image !== "undefined" && offset !== 0) new Image().src = publicImageUrl(episodeId, page);
    }
  }, [paged, units, index, episodeId]);

  useEffect(() => {
    if (!paged || open) return;
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      const step = stepForKey(event.key, direction);
      if (step !== null) { event.preventDefault(); go(step); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paged, open, direction, go]);

  const last = index === units.length - 1;
  const position = (() => {
    const from = pages.indexOf(unit[0]) + 1;
    return unit.length > 1 ? `${from}–${from + unit.length - 1} / ${pages.length}` : `${from} / ${pages.length}`;
  })();
  const episodeLinks = <div className="d-flex gap-2 align-items-center">
    {previous ? <Link className="btn btn-outline-light btn-sm" href={`/read/${encodeURIComponent(previous.episodeId)}`}>← 이전화</Link> : <span className="btn btn-outline-secondary btn-sm disabled" aria-disabled="true">← 이전화</span>}
    {next ? <Link className="btn btn-outline-light btn-sm" href={`/read/${encodeURIComponent(next.episodeId)}`}>다음화 →</Link> : <span className="btn btn-outline-secondary btn-sm disabled" aria-disabled="true">다음화 →</span>}
  </div>;
  // a div, not a p: the global "main p[role=status]" rule would turn the text dark-grey on the dark viewer
  const endNotice = <div role="status" className="viewer-end">
    마지막 쪽입니다. {next ? <Link href={`/read/${encodeURIComponent(next.episodeId)}`}>다음화로: {next.title} →</Link> : "마지막 회차입니다."}
  </div>;
  const arrow = (side: "left" | "right") => {
    const step = stepForSide(side, direction);
    const blocked = step === 1 ? last : index === 0;
    return <button type="button" className={`viewer-arrow viewer-arrow-${side}`} disabled={blocked} aria-label={step === 1 ? "다음 쪽" : "이전 쪽"} onClick={() => go(step)}>{side === "left" ? "‹" : "›"}</button>;
  };

  return <section className="viewer" aria-label={`${title} 뷰어`}>
    <div className="viewer-bar">
      <Link href={listHref} className="btn btn-outline-light btn-sm">목록</Link>
      <h1 className="h6 mb-0 flex-grow-1 text-truncate">{title}</h1>
      {episodeLinks}
      <button type="button" className="btn btn-outline-light btn-sm" onClick={() => setOpen(true)}>설정</button>
    </div>
    {open && <SettingsPanel settings={settings} wide={wide} onChange={change} onClose={() => setOpen(false)} />}
    {paged
      ? <>
        <div className="viewer-stage" onTouchStart={(event) => { const t = event.changedTouches[0]; touch.current = t ? { x: t.clientX, y: t.clientY } : null; }}
          onTouchEnd={(event) => {
            const t = event.changedTouches[0], start = touch.current;
            touch.current = null;
            if (!t || !start) return;
            const step = stepForSwipe(t.clientX - start.x, t.clientY - start.y, direction);
            if (step !== null) go(step);
          }}>
          <div className={`viewer-spread ${direction}${unit.length > 1 ? " two" : ""}`}>
            {unit.map((page) => <ViewerImage key={page} episodeId={episodeId} pageNo={page} scroll={false} />)}
          </div>
          <div className="viewer-zone viewer-zone-left" aria-hidden="true" data-testid="zone-left" onClick={() => go(stepForSide("left", direction))} />
          <div className="viewer-zone viewer-zone-right" aria-hidden="true" data-testid="zone-right" onClick={() => go(stepForSide("right", direction))} />
          {arrow("left")}
          {arrow("right")}
        </div>
        <div className={`viewer-progress ${direction}`} aria-hidden="true"><span style={{ width: `${((index + 1) / units.length) * 100}%` }} /></div>
        <div className="viewer-bar">
          <span aria-live="polite" className="small">{position}</span>
          <select aria-label="페이지 선택" className="form-select form-select-sm w-auto" value={unit[0]} onChange={(event) => setPageNo(Number(event.target.value))}>
            {units.map((entry) => <option key={entry[0]} value={entry[0]}>{entry.length > 1 ? `${entry[0]}–${entry[entry.length - 1]}쪽` : `${entry[0]}쪽`}</option>)}
          </select>
          <span className="flex-grow-1" />
          {episodeLinks}
        </div>
        {last && endNotice}
      </>
      : <>
        <div className="viewer-scroll">
          {pages.map((page) => <ViewerImage key={page} episodeId={episodeId} pageNo={page} scroll />)}
        </div>
        {endNotice}
        <div className="viewer-bar">
          <span className="flex-grow-1" />
          {episodeLinks}
        </div>
      </>}
  </section>;
}
