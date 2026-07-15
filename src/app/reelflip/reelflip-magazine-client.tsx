"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Play, Images, AtSign } from "lucide-react";
import type { ReelflipMagazinePost } from "@/lib/reelflip-magazine";

/* eslint-disable @next/next/no-img-element */

// react-pageflip touches the DOM — load client-only.
const HTMLFlipBook = dynamic(() => import("react-pageflip"), { ssr: false });

// A single magazine page — plain div so react-pageflip can wrap/ref it. No null
// children ever (that throws "argument must be a React element").
function Page({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`reel-page relative h-full w-full overflow-hidden bg-[#0a0a0a] ${className}`}>{children}</div>
  );
}

function PostPage({ post, index }: { post: ReelflipMagazinePost; index: number }) {
  const [playing, setPlaying] = useState(false);
  const video = post.media.find((m) => m.kind === "video");
  const isCarousel = post.mediaType === "CAROUSEL_ALBUM";
  const caption = (post.caption ?? "").trim();
  const date = new Date(post.postedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <Page>
      {playing && video ? (
        <video src={video.url} poster={video.poster ?? post.coverUrl} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
      ) : (
        <>
          <img src={post.coverUrl} alt="" className="h-full w-full object-cover" draggable={false} />
          {/* readability gradient */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30" />
          {/* top badges */}
          <div className="absolute left-3 right-3 top-3 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-white/70">
            <span>{date}</span>
            {isCarousel && (
              <span className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 backdrop-blur">
                <Images className="h-3 w-3" /> álbum
              </span>
            )}
          </div>
          {video && (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:scale-105 hover:bg-black/70"
              aria-label="Play"
            >
              <Play className="h-6 w-6 translate-x-0.5" fill="currentColor" />
            </button>
          )}
          {caption && (
            <div className="absolute inset-x-0 bottom-0 p-4">
              <p className="line-clamp-5 whitespace-pre-line text-[13px] leading-snug text-white/95" style={{ textShadow: "0 1px 3px rgba(0,0,0,.6)" }}>
                {caption}
              </p>
            </div>
          )}
          <span className="absolute bottom-2 right-3 text-[9px] font-semibold text-white/40">{index + 1}</span>
        </>
      )}
    </Page>
  );
}

export function ReelflipMagazineClient({ posts }: { posts: ReelflipMagazinePost[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookRef = useRef<any>(null);
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const flip = (dir: -1 | 1) => {
    const pf = bookRef.current?.pageFlip?.();
    if (!pf) return;
    dir === 1 ? pf.flipNext() : pf.flipPrev();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") flip(1);
      if (e.key === "ArrowLeft") flip(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Cover + one page per post. Filtered so no nulls reach the flipbook.
  const pages = useMemo(() => {
    const cover = (
      <Page key="cover" className="flex flex-col items-center justify-center bg-[#0a0a0a] text-center">
        {posts[0] && <img src={posts[0].coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" draggable={false} />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/90" />
        <div className="relative z-10 px-6">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.35em] text-[#cbff3e]">Instagram Archive</p>
          <h1 className="font-mono text-5xl font-black tracking-tight text-white">REELFLIP</h1>
          <p className="mx-auto mt-3 max-w-[16rem] text-[13px] leading-snug text-white/70">
            Não é sobre andar de skate. É sobre enxergar como quem anda.
          </p>
          <p className="mt-6 text-[10px] uppercase tracking-widest text-white/40">{posts.length} páginas · vire →</p>
        </div>
      </Page>
    );
    const postPages = posts.map((p, i) => <PostPage key={p.id} post={p} index={i} />);
    const back = (
      <Page key="back" className="flex flex-col items-center justify-center gap-4 bg-[#0a0a0a] text-center">
        <h2 className="font-mono text-2xl font-bold text-white">fim.</h2>
        <a
          href="https://instagram.com/reelflip"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm text-white transition hover:border-[#cbff3e] hover:text-[#cbff3e]"
        >
          <AtSign className="h-4 w-4" /> reelflip
        </a>
      </Page>
    );
    return [cover, ...postPages, back].filter(Boolean);
  }, [posts]);

  const total = pages.length;

  if (!posts.length) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="font-mono text-4xl font-black text-foreground">REELFLIP</h1>
        <p className="text-sm text-foreground-muted">A revista está sendo montada. Volte em breve.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-3 py-6">
      <div className="relative">
        {ready && (
          // @ts-expect-error — react-pageflip's types don't include all props
          <HTMLFlipBook
            ref={bookRef}
            width={420}
            height={580}
            size="stretch"
            minWidth={300}
            maxWidth={560}
            minHeight={420}
            maxHeight={760}
            maxShadowOpacity={0.5}
            drawShadow
            showCover
            mobileScrollSupport
            flippingTime={700}
            className="reel-book"
            onFlip={(e: { data: number }) => setPage(e.data)}
          >
            {pages}
          </HTMLFlipBook>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => flip(-1)} disabled={page <= 0} className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-30" aria-label="Anterior">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-16 text-center font-mono text-xs text-foreground-muted">{Math.min(page + 1, total)} / {total}</span>
        <button type="button" onClick={() => flip(1)} disabled={page >= total - 1} className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-30" aria-label="Próxima">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
