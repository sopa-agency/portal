"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Play, AtSign } from "lucide-react";
import type { ReelflipMagazinePost, ReelflipMediaItem } from "@/lib/reelflip-magazine";

/* eslint-disable @next/next/no-img-element */

// react-pageflip touches the DOM — load client-only.
const HTMLFlipBook = dynamic(() => import("react-pageflip"), { ssr: false });

// ─────────────────────────────────────────────────────────────────────────────
// Pages. react-pageflip sets a ref on each TOP-LEVEL child and only initializes
// once those refs point at DOM nodes. This repo is React 19 (no Chakra Box like
// sk3's Magazine.tsx), so every direct child of HTMLFlipBook MUST be a
// forwardRef component that attaches the ref to its outer <div> — a plain
// function component silently drops the ref and the flip never works.
// ─────────────────────────────────────────────────────────────────────────────

const Page = forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  function Page({ children, className = "" }, ref) {
    return (
      <div
        ref={ref}
        className={`relative h-full w-full overflow-hidden bg-[#0a0a0a] ${className}`}
      >
        {children}
      </div>
    );
  },
);

// One flattened magazine page = one media item of one post (carousels emit one
// page per slide, in order — the whole point of the archive).
type FlatPage = {
  post: ReelflipMagazinePost;
  item: ReelflipMediaItem;
  slide: number; // 0-based index within the post
  slideCount: number;
};

const MediaPage = forwardRef<HTMLDivElement, { flat: FlatPage }>(function MediaPage(
  { flat },
  ref,
) {
  const { post, item, slide, slideCount } = flat;
  const [playing, setPlaying] = useState(false);
  const isFirst = slide === 0;
  const caption = (post.caption ?? "").trim();
  const date = new Date(post.postedAt).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (item.kind === "video" && playing) {
    return (
      <Page ref={ref}>
        <video
          src={item.url}
          poster={item.poster ?? post.coverUrl}
          controls
          autoPlay
          playsInline
          onMouseDown={stop}
          onTouchStart={stop}
          className="h-full w-full bg-black object-contain"
        />
      </Page>
    );
  }

  return (
    <Page ref={ref}>
      <img
        src={item.kind === "video" ? (item.poster ?? post.coverUrl) : item.url}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
        loading="lazy"
      />

      {item.kind === "video" && (
        <button
          type="button"
          onMouseDown={stop}
          onTouchStart={stop}
          onClick={(e) => {
            e.stopPropagation();
            setPlaying(true);
          }}
          className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:scale-105 hover:bg-black/70"
          aria-label="Reproduzir vídeo"
        >
          <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />
        </button>
      )}

      {isFirst ? (
        <>
          {/* readability scrim */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40" />
          {/* top: date + slide indicator */}
          <div className="pointer-events-none absolute left-4 right-4 top-4 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-white/75">
            <span>{date}</span>
            {slideCount > 1 && (
              <span className="rounded-full bg-black/45 px-2 py-0.5 backdrop-blur">
                1/{slideCount}
              </span>
            )}
          </div>
          {/* bottom: caption + permalink */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5">
            {caption && (
              <p
                className="pointer-events-none line-clamp-4 whitespace-pre-line text-sm leading-snug text-white/95"
                style={{ textShadow: "0 1px 3px rgba(0,0,0,.7)" }}
              >
                {caption}
              </p>
            )}
            {post.permalink && (
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                onMouseDown={stop}
                onTouchStart={stop}
                onClick={stop}
                className="inline-flex w-fit items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-white/60 transition hover:text-[#cbff3e]"
              >
                <AtSign className="h-3 w-3" /> ver no instagram
              </a>
            )}
          </div>
        </>
      ) : (
        slideCount > 1 && (
          <span className="pointer-events-none absolute bottom-3 right-4 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/60 backdrop-blur">
            {slide + 1}/{slideCount}
          </span>
        )
      )}
    </Page>
  );
});

// ─────────────────────────────────────────────────────────────────────────────

export function ReelflipMagazineClient({ posts }: { posts: ReelflipMagazinePost[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instRef = useRef<any>(null); // fallback: PageFlip instance from onInit
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = 0.2;
  }, [ready]);

  const playSound = () => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0.02;
    void a.play().catch(() => {});
  };

  // Flatten: cover-less posts fall back to their coverUrl so no page is empty.
  const flatPages = useMemo<FlatPage[]>(
    () =>
      posts.flatMap((post) => {
        const media: ReelflipMediaItem[] = post.media.length
          ? post.media
          : [{ kind: "image", url: post.coverUrl }];
        return media.map((item, slide) => ({
          post,
          item,
          slide,
          slideCount: media.length,
        }));
      }),
    [posts],
  );

  const getBook = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viaRef: any = bookRef.current?.pageFlip?.();
    if (viaRef) return viaRef;
    const inst = instRef.current;
    return inst && typeof inst.flipNext === "function" ? inst : null;
  };
  const flip = (dir: -1 | 1) => {
    const book = getBook();
    if (!book) return;
    if (dir === 1) book.flipNext();
    else book.flipPrev();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") flip(1);
      if (e.key === "ArrowLeft") flip(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cover + one page per media item + back cover. Filtered so no null/false
  // ever reaches HTMLFlipBook (it throws on non-element children).
  const pages = useMemo(() => {
    const cover = (
      <Page key="cover" className="flex flex-col items-center justify-center text-center">
        {posts[0] && (
          <img
            src={posts[0].coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-40"
            draggable={false}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/90" />
        <div className="relative z-10 px-8">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.35em] text-[#cbff3e]">
            Instagram Archive
          </p>
          <h1 className="font-mono text-6xl font-black tracking-tight text-white md:text-7xl">
            REELFLIP
          </h1>
          <p className="mx-auto mt-4 max-w-xs text-sm leading-snug text-white/70">
            Não é sobre andar de skate. É sobre enxergar como quem anda.
          </p>
          <p className="mt-8 text-[11px] uppercase tracking-widest text-white/40">
            {flatPages.length} páginas · vire →
          </p>
        </div>
      </Page>
    );
    const mediaPages = flatPages.map((flat) => (
      <MediaPage key={`${flat.post.id}-${flat.slide}`} flat={flat} />
    ));
    const back = (
      <Page key="back" className="flex flex-col items-center justify-center gap-5 text-center">
        <h2 className="font-mono text-3xl font-bold text-white">fim.</h2>
        <a
          href="https://instagram.com/reelflip"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm text-white transition hover:border-[#cbff3e] hover:text-[#cbff3e]"
        >
          <AtSign className="h-4 w-4" /> reelflip
        </a>
      </Page>
    );
    return [cover, ...mediaPages, back].filter(Boolean);
  }, [posts, flatPages]);

  const total = pages.length;

  if (!posts.length) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="font-mono text-4xl font-black text-foreground">REELFLIP</h1>
        <p className="text-sm text-foreground-muted">
          A revista está sendo montada. Volte em breve.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-background px-2 py-4">
      <audio ref={audioRef} src="/pageflip.mp3" preload="auto" />

      <div className="w-full max-w-6xl">
        {ready && (
          // Config mirrored from the proven sk3 Magazine.tsx setup.
          <HTMLFlipBook
            ref={bookRef}
            className="flipbook"
            style={{ width: "100%", height: "90vh" }}
            width={1000}
            height={1300}
            minWidth={0}
            maxWidth={10000}
            minHeight={0}
            maxHeight={10000}
            startPage={0}
            size="stretch"
            drawShadow={false}
            flippingTime={600}
            usePortrait
            startZIndex={0}
            autoSize={false}
            maxShadowOpacity={0.1}
            showCover={false}
            mobileScrollSupport={false}
            swipeDistance={30}
            clickEventForward={false}
            useMouseEvents
            renderOnlyPageLengthChange={true}
            showPageCorners={false}
            disableFlipByClick={false}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onInit={(e: any) => {
              instRef.current = e?.object ?? e;
            }}
            onFlip={(e: { data: number }) => {
              setPage(e.data);
              playSound();
              // Pause any inline post video still playing on the page we left.
              document.querySelectorAll(".flipbook video").forEach((v) => {
                const vid = v as HTMLVideoElement;
                if (!vid.paused) vid.pause();
              });
            }}
          >
            {pages}
          </HTMLFlipBook>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => flip(-1)}
          disabled={page <= 0}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-30"
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-16 text-center font-mono text-xs text-foreground-muted">
          {Math.min(page + 1, total)} / {total}
        </span>
        <button
          type="button"
          onClick={() => flip(1)}
          disabled={page >= total - 1}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-30"
          aria-label="Próxima página"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Perf hints + scrollbar hiding for the flipbook (mirrors sk3). */}
      <style>{`
        .flipbook {
          will-change: transform;
          transform: translateZ(0);
          touch-action: pan-y pinch-zoom;
        }
        .flipbook * {
          touch-action: manipulation;
        }
        .flipbook,
        .flipbook * {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        .flipbook::-webkit-scrollbar,
        .flipbook *::-webkit-scrollbar {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
