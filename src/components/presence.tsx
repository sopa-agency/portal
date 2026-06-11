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
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Live presence over Supabase Realtime (the userbase project's public key):
// - presence: who's online in THIS portal (avatars at the sidebar bottom)
// - broadcast: cursor positions, rendered live for teammates on the SAME page
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

function getRealtimeClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 25 } },
  });
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
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const client = getRealtimeClient();
    if (!client) return;

    const channel = client.channel(`portal-presence:${projectSlug}`, {
      config: { presence: { key: username }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ username: string; path: string }>();
        const users: OnlineUser[] = [];
        for (const key of Object.keys(state)) {
          const metas = state[key];
          const last = metas[metas.length - 1];
          if (last) users.push({ username: last.username ?? key, path: last.path ?? "/" });
        }
        users.sort((a, b) => a.username.localeCompare(b.username));
        setOnline(users);
      })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        const c = payload as CursorState;
        if (!c?.username || c.username === username) return;
        setCursors((prev) => ({ ...prev, [c.username]: { ...c, at: Date.now() } }));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ username, path: pathRef.current });
        }
      });

    // Cursor broadcasting — viewport fractions, throttled.
    let lastSent = 0;
    const onMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - lastSent < CURSOR_THROTTLE_MS) return;
      lastSent = now;
      void channel.send({
        type: "broadcast",
        event: "cursor",
        payload: {
          username,
          x: e.clientX / window.innerWidth,
          y: e.clientY / window.innerHeight,
          path: pathRef.current,
        },
      });
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
      window.removeEventListener("pointermove", onMove);
      window.clearInterval(sweep);
      void channel.unsubscribe();
      void client.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, username]);

  // Re-track on route change so presence shows where everyone is.
  useEffect(() => {
    const channel = channelRef.current;
    if (channel?.state === "joined") {
      void channel.track({ username, path: pathname });
    }
  }, [pathname, username]);

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
