"use client";

import { AlertCircle, CheckCircle2, Loader2, Mail, Send, Users } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
  getOutreachStatus,
  prepareOutreach,
  sendOutreachBatch,
  type OutreachStatus,
} from "@/app/actions/outreach";

type Mode = "inactive" | "all_subscribed";

/**
 * Controlled outreach delivery for a campaign's email — enqueue an audience
 * (inactive skaters by default), then send in manual daily-controlled batches.
 * Per-recipient tracking means nobody is re-emailed within the campaign.
 */
export function CampaignOutreachPanel({ campaignId }: { campaignId: string }) {
  const [status, setStatus] = useState<OutreachStatus | null>(null);
  const [mode, setMode] = useState<Mode>("inactive");
  const [batchSize, setBatchSize] = useState(20);
  const [testEmail, setTestEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => getOutreachStatus(campaignId).then(setStatus);
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Gate errors (wrong tenant, no session) hide the panel entirely.
  if (status && !status.ok) return null;

  const prepare = () => {
    setResult(null);
    startTransition(async () => {
      const res = await prepareOutreach(campaignId, { mode });
      if (res.ok) {
        setResult({
          kind: "ok",
          msg: `${res.enqueued} novo${res.enqueued === 1 ? "" : "s"} na fila (${res.audience} no público de ${res.pool} inscritos).`,
        });
        await refresh();
      } else {
        setResult({ kind: "error", msg: res.error });
      }
    });
  };

  const runTest = () => {
    setResult(null);
    startTransition(async () => {
      const res = await sendOutreachBatch(campaignId, { testTo: testEmail });
      if (res.ok) setResult({ kind: "ok", msg: `Teste enviado para ${testEmail}.` });
      else setResult({ kind: "error", msg: res.error });
    });
  };

  const sendBatch = () => {
    setConfirming(false);
    setResult(null);
    startTransition(async () => {
      const res = await sendOutreachBatch(campaignId, { batchSize });
      if (res.ok) {
        const parts = [`${res.sent} enviado${res.sent === 1 ? "" : "s"}`];
        if (res.failed) parts.push(`${res.failed} falha${res.failed === 1 ? "" : "s"}`);
        if (res.responded) parts.push(`${res.responded} responderam`);
        parts.push(`${res.remaining} na fila`);
        setResult({ kind: "ok", msg: parts.join(" · ") });
        await refresh();
      } else {
        setResult({ kind: "error", msg: res.error });
      }
    });
  };

  const s = status?.ok ? status : null;
  const stat = (label: string, value: number) => (
    <div className="rounded-lg border border-border bg-surface-elevated px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-foreground-subtle">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  );

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">
        <Send className="h-3.5 w-3.5" /> Entrega controlada (outreach)
      </p>
      <p className="mt-1 text-sm text-foreground-muted">
        Envia este email em <span className="text-foreground">lotes</span> para o público-alvo, registrando quem já
        foi abordado — ninguém recebe duas vezes.
      </p>

      {!s ? (
        <p className="mt-4 flex items-center gap-1.5 text-[12px] text-foreground-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando status…
        </p>
      ) : !s.hasEmail ? (
        <p className="mt-4 flex items-center gap-1.5 text-[12px] text-warning">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> Gere o email a partir do brief antes de preparar o envio.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {stat("Na fila", s.pending)}
            {stat("Enviados", s.sent)}
            {stat("Responderam", s.responded)}
            {stat("Hoje", s.sentToday)}
            {stat("Total", s.total)}
          </div>

          {/* Prepare audience */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            >
              <option value="inactive">Inativos (sem postar 90d+)</option>
              <option value="all_subscribed">Todos os inscritos</option>
            </select>
            <button
              type="button"
              onClick={prepare}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-medium text-foreground transition hover:border-border-strong disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
              Preparar público
            </button>
          </div>

          {/* Test send */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="teste@exemplo.com"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={runTest}
              disabled={pending || !testEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-medium text-foreground transition hover:border-border-strong disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              Enviar teste
            </button>
          </div>

          {/* Send batch (confirm-guarded) */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-[12px] text-foreground-subtle">Lote de</label>
            <input
              type="number"
              min={1}
              max={500}
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              className="w-20 rounded-lg border border-border bg-surface-elevated px-2 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
            {confirming ? (
              <>
                <button
                  type="button"
                  onClick={sendBatch}
                  disabled={pending || s.pending === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Confirmar: enviar {Math.min(batchSize, s.pending)}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground-muted transition hover:border-border-strong"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setConfirming(true);
                }}
                disabled={pending || s.pending === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                Enviar lote
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-foreground-subtle">
            Comece com lotes pequenos (warm-up) — disparar tudo de uma vez prejudica a reputação de entrega. Cada
            lote leva ~150ms por email.
          </p>
        </>
      )}

      {result && (
        <p
          className={`mt-3 flex items-center gap-1.5 text-[12px] ${
            result.kind === "error" ? "text-danger" : "text-success"
          }`}
        >
          {result.kind === "error" ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          )}
          {result.msg}
        </p>
      )}
    </div>
  );
}
