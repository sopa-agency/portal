"use client";

import { useEffect, useState } from "react";
import { Loader2, Hash, Check } from "lucide-react";
import { listDiscordChannels, saveDiscordChannel, type DiscordChannel } from "@/app/actions/discord";

/**
 * Picks the project's default Discord channel (saved to the DB). Everything that
 * posts to Discord (campaign shooter, lab, team) uses this default unless a send
 * overrides it. The same bot/guild can serve several portals on different channels.
 */
export function DiscordChannelPicker({ compact = false }: { compact?: boolean }) {
  const [channels, setChannels] = useState<DiscordChannel[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    listDiscordChannels().then((r) => {
      if (r.ok) {
        setChannels(r.channels);
        setSelected(r.currentId ?? "");
        setSavedId(r.currentId ?? null);
      } else {
        setChannels([]);
        setErr(r.error);
      }
    });
  }, []);

  async function save() {
    const ch = channels?.find((c) => c.id === selected);
    setBusy(true); setMsg(null); setErr(null);
    const r = await saveDiscordChannel(selected, ch?.name);
    setBusy(false);
    if (r.ok) { setSavedId(selected); setMsg("Canal salvo ✅"); }
    else setErr(r.error);
  }

  return (
    <div className={compact ? "" : "rounded-xl border border-border bg-surface p-3"}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-faint">
        <Hash className="h-3 w-3 text-[#5865F2]" /> Canal padrão
      </div>
      {!compact && <p className="mt-0.5 text-[11px] text-foreground-faint">Pra onde este portal posta no Discord (campanhas, lab, time). Mesmo bot/servidor pode usar canais diferentes por portal.</p>}
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      {msg && <p className="mt-2 text-xs text-success">{msg}</p>}

      {channels === null ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Lendo canais…</p>
      ) : channels.length === 0 ? (
        !err && <p className="mt-2 text-xs text-foreground-faint">Nenhum canal de texto encontrado.</p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-foreground focus:border-border-strong focus:outline-none"
          >
            <option value="" disabled>Escolha um canal…</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>#{c.name}{c.id === savedId ? " (atual)" : ""}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={busy || !selected || selected === savedId}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : selected === savedId ? <Check className="h-3.5 w-3.5" /> : "Salvar"}
          </button>
        </div>
      )}
    </div>
  );
}
