"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Crosshair, MessageCircle, Plus, Send, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ComponentSelection = {
  label: string;
  selector: string;
  ancestry: string;
  tag: string;
  role: string;
  text: string;
  html: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    scrollX: number;
    scrollY: number;
  };
  styles: Record<string, string>;
  nearestHeading?: string;
};

type FloatingPosition = {
  chat: { x: number; y: number };
  button: { x: number; y: number };
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type FloatingAgentChatProps = {
  projectSlug: string;
  agentId: string;
  agentName: string;
  agentEmoji?: string;
  greeting?: string;
  logo: string;
  /** When true, a failed/timed-out turn offers to park the task as a Kanban card. */
  kanbanEnabled?: boolean;
};

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

function defaultFloatingPosition(): FloatingPosition {
  if (typeof window === "undefined") {
    return { chat: { x: 920, y: 220 }, button: { x: 1100, y: 860 } };
  }
  return {
    chat: {
      x: Math.max(16, window.innerWidth - 444),
      y: Math.max(16, window.innerHeight - 664),
    },
    button: {
      x: Math.max(16, window.innerWidth - 265),
      y: Math.max(16, window.innerHeight - 80),
    },
  };
}

function clampPosition(
  point: { x: number; y: number },
  size: { width: number; height: number },
) {
  if (typeof window === "undefined") return point;
  return {
    x: Math.min(Math.max(8, point.x), Math.max(8, window.innerWidth - size.width - 8)),
    y: Math.min(Math.max(8, point.y), Math.max(8, window.innerHeight - size.height - 8)),
  };
}

// ---------------------------------------------------------------------------
// Page context collector
// ---------------------------------------------------------------------------

function uniqueTexts(values: string[], limit = 8) {
  const out: string[] = [];
  for (const value of values) {
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean || out.includes(clean)) continue;
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

function collectPageContext(): string {
  if (typeof window === "undefined") return "";

  const title = document.title.trim();
  const url = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const h1 = document.querySelector("main h1")?.textContent?.trim() || "";
  const activeTabs = uniqueTexts(
    Array.from(
      document.querySelectorAll('[data-slot="tabs-trigger"][data-state="active"]'),
    ).map((node) => node.textContent || ""),
  );
  const headings = uniqueTexts(
    Array.from(
      document.querySelectorAll("main h2, main h3, [data-slot='card-title']"),
    ).map((node) => node.textContent || ""),
  );

  return [
    "[Portal context]",
    `URL: ${url}`,
    title ? `Page title: ${title}` : "",
    h1 ? `Main heading: ${h1}` : "",
    activeTabs.length ? `Active tabs: ${activeTabs.join(" | ")}` : "",
    headings.length ? `Visible sections: ${headings.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// DOM inspector helpers
// ---------------------------------------------------------------------------

function compactText(value: string, max = 1200) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function compactHtml(element: Element, max = 8000) {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
  const html = clone.outerHTML.replace(/\s+/g, " ").trim();
  return html.length > max ? `${html.slice(0, max)}…` : html;
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function selectorFor(element: Element): string {
  if (element.id) return `#${cssEscape(element.id)}`;
  const testId =
    element.getAttribute("data-testid") || element.getAttribute("data-slot");
  if (testId) {
    const attr = element.hasAttribute("data-testid") ? "data-testid" : "data-slot";
    return `${element.tagName.toLowerCase()}[${attr}="${testId}"]`;
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const classNames = Array.from(current.classList).filter((n) => !n.includes(":"));
    const classPart = classNames
      .slice(0, 2)
      .map((n) => `.${cssEscape(n)}`)
      .join("");
    const parent = current.parentElement;
    const siblings = parent
      ? Array.from(parent.children).filter((child) => child.tagName === current?.tagName)
      : [];
    const nth =
      siblings.length > 1 && parent
        ? `:nth-of-type(${siblings.indexOf(current) + 1})`
        : "";
    parts.unshift(`${tag}${classPart}${nth}`);
    current = current.parentElement;
  }
  return parts.join(" > ") || element.tagName.toLowerCase();
}

function ancestryFor(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && parts.length < 8) {
    const label =
      current.getAttribute("aria-label") ||
      current.getAttribute("data-slot") ||
      current.id ||
      current.tagName.toLowerCase();
    parts.unshift(label);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function collectComponentContext(element: Element): ComponentSelection {
  const rect = element.getBoundingClientRect();
  const computed = window.getComputedStyle(element);
  const styleKeys = [
    "display",
    "position",
    "z-index",
    "width",
    "height",
    "padding",
    "margin",
    "border",
    "border-radius",
    "background-color",
    "color",
    "font-size",
    "font-weight",
    "line-height",
    "overflow",
  ];
  const styles = Object.fromEntries(
    styleKeys.map((key) => [key, computed.getPropertyValue(key)]),
  );
  const text = compactText(element.textContent || "");
  const label = compactText(
    element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      text ||
      `${element.tagName.toLowerCase()} component`,
    80,
  );
  const nearestHeading =
    element
      .closest("section, article, main, [data-slot='card']")
      ?.querySelector("h1, h2, h3, [data-slot='card-title']")?.textContent || undefined;

  return {
    label,
    selector: selectorFor(element),
    ancestry: ancestryFor(element),
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute("role") || "",
    text,
    html: compactHtml(element),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
    },
    styles,
    nearestHeading: nearestHeading ? compactText(nearestHeading, 120) : undefined,
  };
}

function formatComponentContext(selection: ComponentSelection | null): string {
  if (!selection) return "";
  return [
    "[Selected portal component]",
    `Label: ${selection.label}`,
    `Selector: ${selection.selector}`,
    `Ancestry: ${selection.ancestry}`,
    `Tag: ${selection.tag}${selection.role ? ` role=${selection.role}` : ""}`,
    selection.nearestHeading ? `Nearest heading: ${selection.nearestHeading}` : "",
    `Rect: x=${selection.rect.x}, y=${selection.rect.y}, w=${selection.rect.width}, h=${selection.rect.height}, viewport=${selection.rect.viewportWidth}x${selection.rect.viewportHeight}, scroll=${selection.rect.scrollX},${selection.rect.scrollY}`,
    `Computed styles: ${JSON.stringify(selection.styles)}`,
    selection.text ? `Visible text: ${selection.text}` : "",
    `Outer HTML: ${selection.html}`,
    "Note: user selected this element visually in the portal. Use this DOM/visual context to identify the exact component before proposing code changes.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Session ID
// ---------------------------------------------------------------------------

function makeSessionId(): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `portal-chat-${raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DEFAULT_GREETING = "Olá! Como posso ajudar?";

/**
 * O balão flutuante some no /chat, e não é só para não colidir com o botão de
 * enviar (media: 99px entre os dois, e a página em largura cheia encosta os
 * dois de vez). É que ali ele não faz sentido: o /chat É esta conversa, com o
 * MESMO agente, em página inteira. Dois campos de conversa com o mesmo
 * interlocutor na mesma tela é escolha que a pessoa não deveria ter que fazer.
 *
 * O guarda mora num invólucro, e não dentro do componente, porque lá dentro um
 * `return null` antecipado passaria na frente de dezenas de hooks.
 */
export function FloatingAgentChat(props: FloatingAgentChatProps) {
  const pathname = usePathname();
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return null;
  return <FloatingAgentChatPanel {...props} />;
}

function FloatingAgentChatPanel({
  projectSlug,
  agentId,
  agentName,
  kanbanEnabled = false,
  agentEmoji,
  greeting,
  logo,
}: FloatingAgentChatProps) {
  // Per-tenant localStorage key prefixes
  const keyHistory = `portal-chat:${projectSlug}:history`;
  const keyOpen = `portal-chat:${projectSlug}:open`;
  const keyPosition = `portal-chat:${projectSlug}:position`;
  const keySession = `portal-chat:${projectSlug}:session`;

  const effectiveGreeting = greeting || DEFAULT_GREETING;

  // Inspiring productivity line of the day — deterministic (day-of-year), so
  // the whole team sees the same one and fresh chats always open with it.
  const MOTD_LINES = [
    "Ship one real thing before lunch — momentum compounds.",
    "The best post is the one that goes out today, not the perfect one next week.",
    "Small consistent reps beat heroic sprints. What's today's rep?",
    "Done is a feature. Polish is a patch.",
    "Make it work, make it right, make it loud — in that order.",
    "One honest update to the community is worth ten drafts in a drawer.",
    "Start with the task you've been avoiding — it's smaller than it looks.",
    "Today's goal: leave the project better than you found it.",
    "Energy follows action. Start ugly, finish proud.",
    "Cut the scope, keep the soul, ship it.",
    "Your future self is begging you to schedule that post now.",
    "Creativity loves a deadline — give it one today.",
    "The feed rewards the consistent, not the perfect.",
    "Do the 5-minute version first. It usually finishes the job.",
    "A queued post is a gift to tomorrow's you.",
  ];
  function motdOfTheDay(): string {
    const now = new Date();
    const dayOfYear = Math.floor(
      (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000,
    );
    return MOTD_LINES[dayOfYear % MOTD_LINES.length];
  }

  function initialMessages(): ChatMessage[] {
    return [
      { id: "welcome", role: "assistant", text: effectiveGreeting },
      { id: "motd", role: "assistant", text: `💡 ${motdOfTheDay()}` },
    ];
  }

  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [deepMode, setDeepMode] = useState(false);
  const [sending, setSending] = useState(false);
  // Failed-turn → Kanban handoff: the request that errored/timed out, parked
  // for a human to pick up later.
  const [failedTask, setFailedTask] = useState<string | null>(null);
  const [cardState, setCardState] = useState<"idle" | "creating" | "created" | "failed">("idle");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [selectingComponent, setSelectingComponent] = useState(false);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [selectedComponent, setSelectedComponent] =
    useState<ComponentSelection | null>(null);
  const [floatingPosition, setFloatingPosition] =
    useState<FloatingPosition | null>(null);

  const didDragRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // -------------------------------------------------------------------------
  // Bootstrap from localStorage
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Session
    const storedSession = localStorage.getItem(keySession) || makeSessionId();
    localStorage.setItem(keySession, storedSession);
    setSessionId(storedSession);

    // Open state
    const storedOpen = localStorage.getItem(keyOpen);
    setOpen(storedOpen === "1");

    // Position
    const rawPosition = localStorage.getItem(keyPosition);
    if (rawPosition) {
      try {
        const parsed = JSON.parse(rawPosition) as FloatingPosition;
        setFloatingPosition({
          chat: clampPosition(parsed.chat ?? defaultFloatingPosition().chat, {
            width: 420,
            height: 640,
          }),
          button: clampPosition(
            parsed.button ?? defaultFloatingPosition().button,
            { width: 250, height: 56 },
          ),
        });
      } catch {
        setFloatingPosition(defaultFloatingPosition());
      }
    } else {
      setFloatingPosition(defaultFloatingPosition());
    }

    // History — keyed by sessionId so switching sessions doesn't bleed history
    const historyKey = `${keyHistory}:${storedSession}`;
    const rawHistory = localStorage.getItem(historyKey);
    if (rawHistory) {
      try {
        const parsed = JSON.parse(rawHistory) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length) setMessages(parsed);
      } catch {
        localStorage.removeItem(historyKey);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Import text from other portal surfaces (e.g. Proposed action modal)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onImport = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      const text = detail?.text?.trim();
      if (!text) return;
      setDraft(text);
      setOpen(true);
      setError("");
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    };

    window.addEventListener("portal-chat:import", onImport);
    return () => window.removeEventListener("portal-chat:import", onImport);
  }, []);

  // -------------------------------------------------------------------------
  // Persist state
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!sessionId) return;
    localStorage.setItem(
      `${keyHistory}:${sessionId}`,
      JSON.stringify(messages),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, sessionId]);

  useEffect(() => {
    localStorage.setItem(keyOpen, open ? "1" : "0");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!floatingPosition) return;
    localStorage.setItem(keyPosition, JSON.stringify(floatingPosition));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatingPosition]);

  // -------------------------------------------------------------------------
  // Auto-scroll on new messages
  // -------------------------------------------------------------------------
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [messages, open, sending]);

  // -------------------------------------------------------------------------
  // Component inspector — DOM events
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!selectingComponent) return;

    const pickElement = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      if (chatRef.current?.contains(target)) return null;
      return (
        target.closest(
          "button, a, input, textarea, select, [data-slot='card'], section, article, main, div",
        ) || target
      );
    };

    const onMove = (event: MouseEvent) => {
      const element = pickElement(event.target);
      setHoverRect(element?.getBoundingClientRect() ?? null);
    };
    const onClick = (event: MouseEvent) => {
      const element = pickElement(event.target);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedComponent(collectComponentContext(element));
      setSelectingComponent(false);
      setHoverRect(null);
      setOpen(true);
      setError("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectingComponent(false);
      setHoverRect(null);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [selectingComponent]);

  // -------------------------------------------------------------------------
  // Drag handling
  // -------------------------------------------------------------------------
  function startDrag(
    kind: keyof FloatingPosition,
    event: React.PointerEvent<HTMLElement>,
  ) {
    if (!floatingPosition) return;
    const target = event.target as HTMLElement;
    if (kind === "chat" && target.closest("button, input, textarea, select, a"))
      return;
    event.preventDefault();
    const currentTarget = event.currentTarget;
    currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = floatingPosition[kind];
    const size =
      kind === "chat"
        ? {
            width: chatRef.current?.offsetWidth || 420,
            height: chatRef.current?.offsetHeight || 640,
          }
        : {
            width: currentTarget.offsetWidth || 250,
            height: currentTarget.offsetHeight || 56,
          };
    didDragRef.current = false;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) didDragRef.current = true;
      setFloatingPosition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [kind]: clampPosition({ x: origin.x + dx, y: origin.y + dy }, size),
        };
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  // Park a failed/timed-out request as a Kanban draft card for a human later.
  async function parkAsKanbanCard() {
    if (!failedTask) return;
    setCardState("creating");
    try {
      const title = `[${agentName}] ${failedTask.slice(0, 80)}${failedTask.length > 80 ? "…" : ""}`;
      const body = `Pedido feito no chat do ${agentName} que falhou ou deu timeout — executar com um humano.\n\n---\n\n${failedTask}`;
      const res = await fetch("/api/kanban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "addDraftAuto", title, body }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setCardState(res.ok && data.ok ? "created" : "failed");
    } catch {
      setCardState("failed");
    }
  }

  // -------------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------------
  async function sendMessage() {
    const text = draft.trim();
    if (!text || !sessionId || sending) return;
    setFailedTask(null);
    setCardState("idle");

    const selectionToSend = selectedComponent;
    // Recent turns BEFORE this message — the agent needs them to keep the
    // thread (the HTTP gateway path is stateless per call).
    const historyToSend = messages
      .slice(-12)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 700) }));
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: selectionToSend ? `${text}\n🎯 selected component: ${selectionToSend.label}` : text,
    };

    setMessages((prev) => {
      const next = [...prev, userMessage];
      localStorage.setItem(`${keyHistory}:${sessionId}`, JSON.stringify(next));
      return next;
    });
    setDraft("");
    setSelectedComponent(null);
    setSending(true);
    setStatus("conectando...");
    setError("");

    const context = [
      collectPageContext(),
      formatComponentContext(selectionToSend),
    ]
      .filter(Boolean)
      .join("\n\n");

    // Job id from the server — reachable in the catch for the polling fallback.
    const jobIdRef = { current: null as string | null };

    try {
      const res = await fetch(`/api/agent/chat?stream=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, context, sessionId, history: historyToSend, deep: deepMode }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Não consegui responder agora.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotFinal = false;

      const handleEvent = (raw: string) => {
        const lines = raw.split("\n");
        const eventName =
          lines.find((line) => line.startsWith("event: "))?.slice(7).trim() ||
          "message";
        const dataLine = lines.find((line) => line.startsWith("data: "));
        if (!dataLine) return;

        const data = JSON.parse(dataLine.slice(6)) as {
          message?: string;
          reply?: string;
          error?: string;
          jobId?: string;
        };

        if (eventName === "job") {
          jobIdRef.current = typeof data.jobId === "string" ? data.jobId : null;
          return;
        }
        if (eventName === "status" || eventName === "working") {
          setStatus(data.message || "trabalhando...");
          return;
        }
        if (eventName === "final") {
          gotFinal = true;
          const reply = typeof data.reply === "string" ? data.reply : "";
          if (reply) {
            setMessages((prev) => {
              const next = [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: "assistant" as const,
                  text: reply,
                },
              ];
              localStorage.setItem(
                `${keyHistory}:${sessionId}`,
                JSON.stringify(next),
              );
              return next;
            });
          }
          setStatus("");
          return;
        }
        if (eventName === "error") {
          throw new Error(data.error || "Turno falhou.");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) handleEvent(event);
      }
      if (buffer.trim()) handleEvent(buffer);
      if (!gotFinal) throw new Error("__stream_dropped__");
    } catch (err) {
      const rawMessage =
        err instanceof Error && err.message ? err.message : "Turno falhou.";

      // Big-task fallback: the server keeps working and stores the reply in
      // the job row — poll it for up to 12 minutes before giving up.
      const jobToPoll = jobIdRef.current;
      if (jobToPoll) {
        setStatus("conexão caiu — o agente segue trabalhando, aguardando o resultado…");
        const deadline = Date.now() + (deepMode ? 20 : 12) * 60_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const jr = await fetch(`/api/agent/chat?job=${encodeURIComponent(jobToPoll)}`);
            if (!jr.ok) continue;
            const jd = (await jr.json()) as {
              ok: boolean;
              status?: string;
              reply?: string | null;
              error?: string | null;
            };
            if (jd.status === "done" && jd.reply) {
              setMessages((prev) => {
                const next = [
                  ...prev,
                  { id: `assistant-${Date.now()}`, role: "assistant" as const, text: jd.reply! },
                ];
                localStorage.setItem(`${keyHistory}:${sessionId}`, JSON.stringify(next));
                return next;
              });
              setStatus("");
              setSending(false);
              return;
            }
            if (jd.status === "error") {
              break;
            }
          } catch {
            // transient poll failure — keep trying until the deadline
          }
        }
      }

      const message = rawMessage === "__stream_dropped__" ? "A conexão fechou antes da resposta final." : rawMessage;
      setError(message);
      // Offer to park the failed/timed-out request as a Kanban card for a human.
      if (kanbanEnabled) setFailedTask(text);
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            id: `assistant-error-${Date.now()}`,
            role: "assistant" as const,
            text: `Não perdi a conversa, mas esse turno caiu: ${message}`,
          },
        ];
        localStorage.setItem(
          `${keyHistory}:${sessionId}`,
          JSON.stringify(next),
        );
        return next;
      });
    } finally {
      setSending(false);
      setStatus("");
    }
  }

  function resetChat() {
    const nextSession = makeSessionId();
    localStorage.setItem(keySession, nextSession);
    setSessionId(nextSession);
    setMessages(initialMessages());
    setDraft("");
    setSelectedComponent(null);
    setStatus("");
    setError("");
  }

  const canSend = draft.trim().length > 0 && !sending && !!sessionId;

  // Don't render until position is hydrated (avoids SSR mismatch)
  if (!floatingPosition) return null;

  const chatPos = floatingPosition.chat;
  const btnPos = floatingPosition.button;

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Chat card (expanded)                                                */}
      {/* ------------------------------------------------------------------ */}
      {open ? (
        <div
          ref={chatRef}
          className="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
          style={{
            left: chatPos.x,
            top: chatPos.y,
            width: "min(calc(100vw - 2rem), 420px)",
            height: "min(70vh, 640px)",
          }}
        >
          {/* Header — drag handle */}
          <div
            className="flex cursor-move select-none items-center gap-3 border-b border-border bg-surface-elevated px-4 py-3"
            onPointerDown={(event) => startDrag("chat", event)}
            title="Arrastar para mover"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logo}
              alt={agentName}
              className="h-8 w-8 shrink-0 rounded-full border border-border object-contain"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-none text-foreground">
                {agentEmoji ? `${agentEmoji} ` : ""}{agentName}
              </div>
              <div className="mt-1 text-xs text-foreground-subtle">{agentId}</div>
            </div>
            <button
              type="button"
              onClick={resetChat}
              title="Nova conversa"
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Fechar chat"
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Message list */}
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-4"
          >
            <div className="space-y-3 pr-1">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap shadow-sm ${
                      message.role === "user"
                        ? "bg-accent text-accent-foreground"
                        : "border border-border bg-surface text-foreground"
                    }`}
                  >
                    {message.text}
                  </div>
                </div>
              ))}
              {sending ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-foreground-muted shadow-sm">
                    {status || "pensando..."}
                  </div>
                </div>
              ) : null}
              {!sending && kanbanEnabled && failedTask ? (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground shadow-sm">
                    {cardState === "created" ? (
                      <p className="text-success">✓ Card criado no Kanban — alguém executa depois.</p>
                    ) : (
                      <>
                        <p className="text-foreground-muted">
                          Esse pedido não terminou. Quer que eu crie um card no Kanban pra alguém
                          executar depois?
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void parkAsKanbanCard()}
                            disabled={cardState === "creating"}
                            className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            {cardState === "creating" ? "Criando…" : "Criar card no Kanban"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setFailedTask(null)}
                            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-muted hover:text-foreground"
                          >
                            Dispensar
                          </button>
                        </div>
                        {cardState === "failed" && (
                          <p className="mt-1.5 text-xs text-danger">
                            Não consegui criar o card. Tente pelo Kanban.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Input area */}
          <div className="border-t border-border bg-surface-elevated p-3 space-y-2">
            {/* Selected component indicator */}
            {selectedComponent ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-accent">
                    🎯 Selected: {selectedComponent.label}
                  </div>
                  <div className="truncate text-foreground-subtle">
                    {selectedComponent.selector}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedComponent(null)}
                  className="shrink-0 text-foreground-muted transition-colors hover:text-foreground"
                  aria-label="Clear selected component"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={`Fala com ${agentName} por aqui...`}
              rows={3}
              disabled={sending}
              className="w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint outline-none transition-colors focus:border-border-strong disabled:opacity-60"
            />

            {/* Bottom row: hint + buttons */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-xs text-foreground-subtle">
                {error ? (
                  <span className="text-danger">{error}</span>
                ) : (
                  status || "Select grab DOM · Enter envia"
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeepMode((v) => !v)}
                  disabled={sending}
                  title="Modo tarefa pesada/código — dá ao agente até 20 min (repo, build, refactor…)"
                  aria-pressed={deepMode}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    deepMode
                      ? "border-accent-border bg-accent-bg text-accent"
                      : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
                  }`}
                >
                  🛠️ Deep
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectingComponent((v) => !v);
                    setOpen(false);
                  }}
                  disabled={sending}
                  title="Selecionar componente da página"
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    selectingComponent
                      ? "border-accent-border bg-accent-bg text-accent"
                      : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
                  }`}
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  Select
                </button>
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={!canSend}
                  title="Enviar mensagem"
                  className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground transition-opacity disabled:opacity-40 hover:opacity-90"
                >
                  <Send className="h-3.5 w-3.5" />
                  Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Floating button (collapsed)                                         */}
      {/* ------------------------------------------------------------------ */}
      {!open ? (
        <button
          type="button"
          onPointerDown={(event) => startDrag("button", event)}
          onClick={() => {
            if (didDragRef.current) return;
            setOpen(true);
          }}
          className="fixed z-[100] flex h-14 items-center gap-2 rounded-full border border-border bg-surface pl-2 pr-4 shadow-xl transition-shadow hover:shadow-2xl"
          style={{ left: btnPos.x, top: btnPos.y }}
          title={`Abrir chat com ${agentName}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logo}
            alt={agentName}
            className="h-10 w-10 shrink-0 rounded-full border border-border object-contain"
          />
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {agentEmoji ? `${agentEmoji} ` : ""}
            {agentName}
          </span>
          <MessageCircle className="h-5 w-5 text-accent" />
        </button>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Component inspector overlay                                          */}
      {/* ------------------------------------------------------------------ */}
      {selectingComponent ? (
        <div className="pointer-events-none fixed inset-0 z-[110] cursor-crosshair bg-background/10">
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-lg">
            Clique em qualquer componente para capturar o contexto DOM · Esc cancela
          </div>
          {hoverRect ? (
            <div
              className="absolute rounded-lg border-2 border-accent bg-accent-bg shadow-[0_0_0_9999px_rgba(0,0,0,0.08)]"
              style={{
                left: hoverRect.x,
                top: hoverRect.y,
                width: hoverRect.width,
                height: hoverRect.height,
              }}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
