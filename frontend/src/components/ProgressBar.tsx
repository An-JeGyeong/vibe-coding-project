import type { Progress } from "@/lib/translation/progress";

/** Translation progress (CONTRACTS 23.2) as an accessible bar plus the plain numbers. */
export function ProgressBar({ progress, unsaved = false }: { progress: Progress; unsaved?: boolean }) {
  return <div className="mb-2">
    <div className="d-flex justify-content-between small">
      <span>번역 진행률</span>
      <span>{progress.done}/{progress.total} 블록 ({progress.percent}%){unsaved && <span className="text-secondary"> · 저장하지 않은 변경 포함</span>}</span>
    </div>
    <div className="progress" style={{ height: "0.6rem" }}>
      <div className="progress-bar" role="progressbar" aria-label="번역 진행률" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={progress.percent} style={{ width: `${progress.percent}%` }} />
    </div>
  </div>;
}
