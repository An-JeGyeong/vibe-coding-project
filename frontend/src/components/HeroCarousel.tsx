"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WorkSummary } from "@/lib/catalog/types";
import { Cover, GenreBadges } from "./CatalogParts";

export const ROTATE_MS = 6000;

function prefersReducedMotion(): boolean {
  try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; } catch { return false; }
}

/**
 * The hero of the main page (CONTRACTS 28.6, D-061): the first slide introduces the service, the following slides show the operator's
 * banner works (the promotions). Moves by buttons and dots, and rotates by itself every few seconds unless the reader pauses it, points at
 * or focuses it, or asks the system for reduced motion. Without banners it is the plain intro without controls.
 */
export function HeroCarousel({ banners }: { banners: WorkSummary[] }) {
  const total = banners.length + 1; // the intro plus the banners
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hold, setHold] = useState(false); // pointer over or focus inside
  const [reduced, setReduced] = useState(false);
  const current = Math.min(index, total - 1);
  const auto = playing && !hold && !reduced && total > 1;

  useEffect(() => { setReduced(prefersReducedMotion()); }, []);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => setIndex((value) => (Math.min(value, total - 1) + 1) % total), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [auto, total]);

  const go = (next: number) => setIndex((next + total) % total);
  const banner = current === 0 ? null : banners[current - 1];

  return <section aria-label="소개와 추천 작품" aria-roledescription="carousel" className="home-hero mb-4"
    onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
    onFocus={() => setHold(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHold(false); }}>
    {banner !== null && <h1 className="visually-hidden">번역된 만화를 읽어 보세요</h1>}
    <div className="hero-slide" role="group" aria-roledescription="slide" aria-label={`${current + 1} / ${total}`} aria-live={auto ? "off" : "polite"}>
      {banner === null
        ? <div className="hero-intro">
          <h1 className="h2 mb-2">번역된 만화를 <em>읽어 보세요</em></h1>
          <p className="text-secondary mb-0">망가브릿지에서 번역·감수를 마치고 공개된 회차를 바로 읽을 수 있습니다.</p>
        </div>
        : <div className="hero-banner">
          <div className="hero-banner-cover"><Cover workId={banner.workId} title={banner.title} hasCover={banner.hasCover} className="hero-cover-img" /></div>
          <div className="hero-banner-text">
            <p className="hero-kicker mb-1">추천 작품</p>
            <h2 className="h3 mb-1">{banner.title}</h2>
            <p className="mb-2">{banner.author}</p>
            <p className="mb-3"><GenreBadges genres={banner.genres} /></p>
            <Link href={`/works/${encodeURIComponent(banner.workId)}`} className="btn btn-primary">작품 보기</Link>
          </div>
        </div>}
    </div>
    {total > 1 && <div className="hero-controls">
      <button type="button" className="hero-btn" onClick={() => go(current - 1)} aria-label="이전 슬라이드">‹</button>
      <div className="hero-dots" role="group" aria-label="슬라이드 선택">
        {Array.from({ length: total }, (_, position) => <button key={position} type="button" className={`hero-dot${position === current ? " on" : ""}`}
          aria-label={`${position + 1}번째 슬라이드`} aria-pressed={position === current} onClick={() => go(position)} />)}
      </div>
      <button type="button" className="hero-btn" onClick={() => go(current + 1)} aria-label="다음 슬라이드">›</button>
      {!reduced && <button type="button" className="hero-btn hero-play" onClick={() => setPlaying(!playing)}>{playing ? "일시정지" : "자동 넘김 켜기"}</button>}
    </div>}
  </section>;
}
