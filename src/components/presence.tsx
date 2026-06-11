"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// Live presence over our own WebSocket relay (presence-relay/server.mjs on the
// Mac mini, exposed via Tailscale Funnel). Nothing is stored anywhere — the
// relay just fans messages out between connected browsers:
// - sync: who's online in THIS portal (avatars at the sidebar bottom)
// - cursor: pointer positions, rendered live for teammates on the SAME page
// Without NEXT_PUBLIC_PRESENCE_WS_URL the whole feature is a clean no-op.
// ---------------------------------------------------------------------------

type OnlineUser = { username: string; path: string };

type CursorState = {
  username: string;
  /** Viewport-fraction coordinates (0..1) — resolution independent. */
  x: number;
  y: number;
  path: string;
  at: number;
};

const PresenceContext = createContext<{ online: OnlineUser[]; self: string }>({
  online: [],
  self: "",
});

export function usePresence() {
  return useContext(PresenceContext);
}

const CURSOR_THROTTLE_MS = 50;
const CURSOR_TTL_MS = 6000; // hide cursors that stopped moving
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

function relayUrl(projectSlug: string, username: string): string | null {
  const base = process.env.NEXT_PUBLIC_PRESENCE_WS_URL;
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = "ws:";
    url.searchParams.set("room", `portal-presence:${projectSlug}`);
    url.searchParams.set("u", username);
    return url.toString();
  } catch {
    return null;
  }
}

export function PresenceProvider({
  username,
  projectSlug,
  children,
}: {
  username: string;
  projectSlug: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [cursors, setCursors] = useState<Record<string, CursorState>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const target = relayUrl(projectSlug, username);
    if (!target) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let retryDelay = RECONNECT_MIN_MS;
    let retryTimer: number | undefined;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(target);
      } catch {
        return; // bad URL — stay dormant
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelay = RECONNECT_MIN_MS;
        ws?.send(JSON.stringify({ type: "track", path: pathRef.current }));
      };

      ws.onmessage = (event) => {
        let msg: { type?: string } & Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.type === "sync" && Array.isArray(msg.users)) {
          setOnline(
            (msg.users as OnlineUser[]).filter((u) => typeof u?.username === "string"),
          );
        } else if (msg.type === "cursor") {
          const c = msg as unknown as CursorState;
          if (!c.username || c.username === username) return;
          setCursors((prev) => ({ ...prev, [c.username]: { ...c, at: Date.now() } }));
        }
      };

      // Reconnect with backoff — the relay lives on a Mac mini; if it
      // restarts, browsers should quietly find their way back.
      ws.onclose = (event) => {
        wsRef.current = null;
        setOnline([]);
        if (closed || event.code === 4001) return; // unauthorized — don't hammer
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
      };
    };

    connect();

    // Cursor broadcasting — viewport fractions, throttled.
    let lastSent = 0;
    const onMove = (e: PointerEvent) => {
      const sock = wsRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - lastSent < CURSOR_THROTTLE_MS) return;
      lastSent = now;
      sock.send(
        JSON.stringify({
          type: "cursor",
          x: e.clientX / window.innerWidth,
          y: e.clientY / window.innerHeight,
          path: pathRef.current,
        }),
      );
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    // Stale-cursor sweep.
    const sweep = window.setInterval(() => {
      setCursors((prev) => {
        const cutoff = Date.now() - CURSOR_TTL_MS;
        const next: Record<string, CursorState> = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (v.at >= cutoff) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 2000);

    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener("pointermove", onMove);
      window.clearInterval(sweep);
      ws?.close();
      wsRef.current = null;
    };
  }, [projectSlug, username]);

  // Re-track on route change so presence shows where everyone is.
  useEffect(() => {
    const sock = wsRef.current;
    if (sock?.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "track", path: pathname }));
    }
  }, [pathname]);

  const value = useMemo(() => ({ online, self: username }), [online, username]);

  return (
    <PresenceContext.Provider value={value}>
      {children}
      {/* Teammates' cursors — same page only */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[70]">
        {Object.values(cursors)
          .filter((c) => c.path === pathname)
          .map((c) => (
            <div
              key={c.username}
              className="absolute transition-transform duration-100 ease-linear"
              style={{
                transform: `translate(${c.x * 100}vw, ${c.y * 100}vh)`,
              }}
            >
              <svg width="14" height="18" viewBox="0 0 14 18" className="drop-shadow">
                <path d="M0 0L14 10L7.5 11L4 18L0 0Z" fill="var(--accent)" />
              </svg>
              <span className="ml-3 inline-block max-w-[140px] truncate rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-background shadow">
                @{c.username}
              </span>
            </div>
          ))}
      </div>
    </PresenceContext.Provider>
  );
}

/** Online avatars row for the sidebar footer. */
export function OnlineAvatars() {
  const { online, self } = usePresence();
  if (online.length === 0) return null;
  const MAX = 5;
  const visible = online.slice(0, MAX);
  const extra = online.length - visible.length;
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5 pt-2">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      <div className="flex -space-x-1.5">
        {visible.map((u) => (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={u.username}
            src={`https://images.hive.blog/u/${u.username}/avatar/small`}
            alt={`@${u.username}`}
            title={`@${u.username}${u.username === self ? " (you)" : ""} — ${u.path}`}
            width={22}
            height={22}
            className={`h-[22px] w-[22px] rounded-full border object-cover ${
              u.username === self ? "border-accent" : "border-border"
            }`}
          />
        ))}
        {extra > 0 && (
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-surface-elevated text-[9px] font-semibold tabular-nums text-foreground-subtle">
            +{extra}
          </span>
        )}
      </div>
      <span className="text-[10px] tabular-nums text-foreground-faint">{online.length} online</span>
    </div>
  );
}
