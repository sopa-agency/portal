"use client";

// Settings → API & MCP. Quem abre a aba sem token já recebe o seu, com os
// comandos preenchidos; o segredo aparece UMA vez. Dali vai para o cliente que
// a pessoa quiser: MCP (Claude Code, Claude Desktop, Cursor…)
// ou REST. O token enxerga o que a pessoa enxerga no portal.
//
// A segunda metade da aba ensina a usar: a primeira mensagem para colar, pedidos
// prontos por família, os atalhos "/" e o catálogo de ferramentas. Exemplos e
// atalhos vêm de `lib/mcp/guide` — a mesma fonte que o agente lê em `get_guide`.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { apiCatalog, apiOpenApi, createApiToken, myApiTokens, revokeApiToken } from "@/app/actions/api-tokens";
import type { TokenRow } from "@/lib/api-tokens";
import type { CatalogEntry } from "@/lib/mcp/tools";
import { EXAMPLES, FIRST_MESSAGE, PROMPTS, TOOL_GROUPS } from "@/lib/mcp/guide";
import { CLIENTS, selfSetupPrompt } from "@/lib/mcp/clients";
import { useLocale } from "@/components/locale-provider";

const STR = {
  pt: {
    intro: "Um token pessoal dá ao seu agente (Claude Code, Cursor, um script) o contexto da SOPA e dos projetos: o retrato de cada projeto, kanban, o que está no seu nome, reuniões, tesouro, custos, campanhas e as notas dos agentes. Ele enxerga o que você enxerga no portal, e só leitura.",
    ready: "Seu token está pronto",
    readyHint: "Copie agora: ele não aparece de novo. Os comandos abaixo já vêm com ele — é colar e usar.",
    another: "Conectar outro cliente",
    anotherHint: (n: number) => `Você tem ${n} token${n === 1 ? "" : "s"} ativo${n === 1 ? "" : "s"}. O segredo só aparece na hora em que o token nasce; para conectar outro cliente, gere um novo e os comandos abaixo vêm preenchidos.`,
    issuing: "Gerando seu token…",
    generate: "Gerar novo token",
    generating: "Gerando…",
    options: "Opções",
    namePlaceholder: "Nome, para você reconhecer depois (opcional)",
    withAgents: "Permitir perguntar aos agentes (gasta modelo; até 10 por dia)",
    copy: "Copiar",
    copied: "Copiado",
    yourTokens: "Seus tokens",
    none: "Nenhum token ainda.",
    created: "criado",
    lastUsed: "último uso",
    never: "nunca usado",
    calls: "chamadas",
    revoke: "Revogar",
    confirmRevoke: "Revogar este token? Quem usa ele para de funcionar na hora.",
    howTo: "1 · Conectar",
    pick: "Escolha onde o seu agente roda. Todo cliente pede as mesmas três coisas — transporte Streamable HTTP, a URL e o cabeçalho Authorization — cada um do seu jeito.",
    other: "Qualquer outro",
    rest: "REST / OpenAPI",
    otherFacts: "Os três fatos que todo cliente MCP pede",
    otherPrompt: "Ou deixe o próprio agente se configurar: cole isto nele",
    otherBridge: "Cliente que só aceita MCP por stdio: a ponte mcp-remote",
    restHint: "Para o que não fala MCP: o mesmo catálogo por HTTP. Quem importa especificação (ações de GPT, n8n, toolkits de OpenAPI) usa o openapi.json.",
    restCalls: "Chamadas",
    restSpec: "Especificação",
    copySpec: "Copiar o OpenAPI",
    placeholderNote: "Sem um token recém-gerado na tela, os comandos mostram SEU_TOKEN: gere um novo acima que eles se preenchem.",
    agents: "agentes",
    first: "2 · A primeira mensagem",
    firstHint: "Conectou? Cole isto no seu agente. Ele confere quem você é, lista seus projetos e te mostra o que dá para pedir. O servidor também já entrega isso ao modelo na conexão, então perguntar \"o que eu posso pedir sobre a SOPA?\" funciona igual.",
    ask: "3 · O que pedir",
    askHint: "Clique para copiar. Troque o que está entre < >.",
    shortcuts: "Atalhos",
    shortcutsHint: "O servidor publica estes prompts. No Claude Code eles aparecem ao digitar / ; no Claude Desktop, no menu +.",
    tools: "Ferramentas",
    toolsHint: "O que o agente chama por baixo. Você não precisa decorar: peça em português que ele escolhe.",
    needsAgents: "precisa do escopo agentes",
  },
  en: {
    intro: "A personal token gives your agent (Claude Code, Cursor, a script) the context of SOPA and its projects: each project's snapshot, kanban, what is on you, meetings, treasury, costs, campaigns and the agents' notes. It sees what you see in the portal, read-only.",
    ready: "Your token is ready",
    readyHint: "Copy it now: it will not be shown again. The commands below already carry it — paste and go.",
    another: "Connect another client",
    anotherHint: (n: number) => `You have ${n} active token${n === 1 ? "" : "s"}. The secret only shows when a token is born; to connect another client, generate a new one and the commands below fill themselves in.`,
    issuing: "Generating your token…",
    generate: "Generate a new token",
    generating: "Generating…",
    options: "Options",
    namePlaceholder: "A name, so you recognise it later (optional)",
    withAgents: "Allow asking the agents (spends model budget; up to 10 a day)",
    copy: "Copy",
    copied: "Copied",
    yourTokens: "Your tokens",
    none: "No tokens yet.",
    created: "created",
    lastUsed: "last used",
    never: "never used",
    calls: "calls",
    revoke: "Revoke",
    confirmRevoke: "Revoke this token? Whatever uses it stops working immediately.",
    howTo: "1 · Connect",
    pick: "Pick where your agent runs. Every client asks for the same three things — Streamable HTTP transport, the URL and the Authorization header — each in its own way.",
    other: "Any other",
    rest: "REST / OpenAPI",
    otherFacts: "The three facts every MCP client asks for",
    otherPrompt: "Or let the agent set itself up: paste this into it",
    otherBridge: "A client that only takes stdio MCP: the mcp-remote bridge",
    restHint: "For whatever does not speak MCP: the same catalog over HTTP. Anything that imports a specification (GPT actions, n8n, OpenAPI toolkits) uses openapi.json.",
    restCalls: "Calls",
    restSpec: "Specification",
    copySpec: "Copy the OpenAPI",
    placeholderNote: "Without a freshly generated token on screen the commands show YOUR_TOKEN: generate a new one above and they fill themselves in.",
    agents: "agents",
    first: "2 · The first message",
    firstHint: "Connected? Paste this into your agent. It checks who you are, lists your projects and shows what you can ask. The server also hands this to the model on connect, so asking \"what can I ask about SOPA?\" works just as well.",
    ask: "3 · What to ask",
    askHint: "Click to copy. Replace what is between < >.",
    shortcuts: "Shortcuts",
    shortcutsHint: "The server publishes these prompts. In Claude Code they show up when you type / ; in Claude Desktop, in the + menu.",
    tools: "Tools",
    toolsHint: "What the agent calls underneath. No need to memorise: ask in plain language and it picks.",
    needsAgents: "needs the agents scope",
  },
};

function useCopied() {
  const [ok, setOk] = useState(false);
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); });
  return [ok, copy] as const;
}

function CopyBlock({ text, label, copiedLabel, wrap }: { text: string; label: string; copiedLabel: string; wrap?: boolean }) {
  const [ok, copy] = useCopied();
  return (
    <div className="relative">
      <pre className={`overflow-x-auto rounded-lg border border-border bg-surface-elevated p-3 pr-24 font-mono text-[11px] leading-relaxed text-foreground ${wrap ? "whitespace-pre-wrap" : ""}`}>{text}</pre>
      <button type="button" onClick={() => copy(text)} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-foreground-muted hover:text-foreground">
        {ok ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />} {ok ? copiedLabel : label}
      </button>
    </div>
  );
}

/** Um pedido pronto: a linha inteira copia. */
function AskLine({ text }: { text: string }) {
  const [ok, copy] = useCopied();
  return (
    <button type="button" onClick={() => copy(text)} className="group flex w-full items-start gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-left text-[13px] leading-snug text-foreground hover:border-border-strong">
      <span className="min-w-0 flex-1">{text}</span>
      {ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-faint group-hover:text-foreground-muted" />}
    </button>
  );
}

export function ApiAccess() {
  const { locale } = useLocale();
  const lang = locale === "pt" ? "pt" : "en";
  const s = STR[lang];
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [showTools, setShowTools] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [client, setClient] = useState("claude-code");
  const [specCopied, setSpecCopied] = useState(false);
  const [name, setName] = useState("");
  const [withAgents, setWithAgents] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const issuedOnOpen = useRef(false);
  // A origem é a do portal em que a pessoa está (cada marca tem o seu domínio).
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "https://sopa.sopa.team");

  async function load(issueFirst = false) {
    const r = await myApiTokens(issueFirst);
    if (r.ok) {
      setTokens(r.tokens);
      setAdmin(r.admin);
      if (r.fresh) setFresh(r.fresh);
    } else setError(r.error);
  }
  useEffect(() => {
    // Quem ainda não tem token recebe o seu ao abrir a aba. A trava evita emitir
    // dois quando o efeito roda em dobro (modo estrito, em desenvolvimento).
    if (issuedOnOpen.current) return;
    issuedOnOpen.current = true;
    void load(true);
    void apiCatalog().then(setCatalog).catch(() => {});
    try {
      const saved = window.localStorage.getItem("sopa-api-client");
      if (saved && (saved === "other" || saved === "rest" || CLIENTS.some((c) => c.id === saved))) setClient(saved);
    } catch {
      /* sem storage */
    }
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const r = await createApiToken(name, withAgents);
      if (r.ok) {
        setFresh(r.token);
        setName("");
        setWithAgents(false);
        await load();
      } else setError(r.error);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!window.confirm(s.confirmRevoke)) return;
    const r = await revokeApiToken(id);
    if (r.ok) await load();
    else setError(r.error);
  }

  // Lembra o harness escolhido: quem usa Codex não quer ver Claude Code toda vez.
  function pickClient(id: string) {
    setClient(id);
    try {
      window.localStorage.setItem("sopa-api-client", id);
    } catch {
      /* sem storage, só não lembra */
    }
  }
  async function copySpec() {
    const spec = await apiOpenApi(origin);
    if (!spec) return;
    await navigator.clipboard.writeText(spec).catch(() => {});
    setSpecCopied(true);
    setTimeout(() => setSpecCopied(false), 1500);
  }
  const chosen = CLIENTS.find((c) => c.id === client);

  const tk = fresh ?? (lang === "pt" ? "SEU_TOKEN" : "YOUR_TOKEN");
  const when = (iso: string) => new Date(iso).toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US", { day: "2-digit", month: "short", year: "numeric" });
  const groups = TOOL_GROUPS.map((g) => ({ ...g, examples: EXAMPLES.filter((e) => e.group === g.id), tools: catalog.filter((t) => t.group === g.id) }));

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm leading-relaxed text-foreground-muted">{s.intro}</p>

      <section className={`rounded-2xl border p-4 ${fresh ? "border-warning/40 bg-warning/10" : "border-border bg-surface"}`}>
        {tokens === null ? (
          <p className="flex items-center gap-2 text-sm text-foreground-muted"><Loader2 className="h-4 w-4 animate-spin" /> {s.issuing}</p>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><KeyRound className={`h-4 w-4 ${fresh ? "text-warning" : "text-accent"}`} /> {fresh ? s.ready : s.another}</p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-foreground-muted">{fresh ? s.readyHint : s.anotherHint(tokens.length)}</p>
            {fresh && <div className="mt-3"><CopyBlock text={fresh} label={s.copy} copiedLabel={s.copied} /></div>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" onClick={() => void create()} disabled={busy} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${fresh ? "border border-border bg-surface text-foreground hover:border-border-strong" : "bg-accent text-accent-foreground"}`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {busy ? s.generating : s.generate}
              </button>
              <button type="button" onClick={() => setShowOptions((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-foreground-muted hover:text-foreground">
                {s.options} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showOptions ? "rotate-180" : ""}`} />
              </button>
            </div>
            {showOptions && (
              <div className="mt-3 space-y-2">
                <input value={name} maxLength={60} placeholder={s.namePlaceholder} onChange={(e) => setName(e.target.value)} className="w-full max-w-md rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground" />
                {admin && (
                  <label className="flex items-center gap-2 text-xs text-foreground-muted">
                    <input type="checkbox" checked={withAgents} onChange={(e) => setWithAgents(e.target.checked)} /> {s.withAgents}
                  </label>
                )}
              </div>
            )}
          </>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-foreground">{s.howTo}</p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-foreground-muted">{s.pick}</p>
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist">
          {[...CLIENTS.map((c) => ({ id: c.id, label: c.label })), { id: "other", label: s.other }, { id: "rest", label: s.rest }].map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={client === c.id} onClick={() => pickClient(c.id)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${client === c.id ? "border-accent-border bg-accent-bg text-accent" : "border-border bg-surface-elevated text-foreground-muted hover:border-border-strong hover:text-foreground"}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {chosen ? (
            <>
              {chosen.note && <p className="max-w-3xl text-xs leading-relaxed text-foreground-muted">{chosen.note[lang]}</p>}
              {chosen.blocks(origin, tk).map((b, n) => (
                <div key={n}>
                  {b.title && <p className="mb-1.5 text-xs font-semibold text-foreground-muted">{b.title[lang]}</p>}
                  <CopyBlock label={s.copy} copiedLabel={s.copied} text={b.text} />
                </div>
              ))}
            </>
          ) : client === "other" ? (
            <>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-foreground-muted">{s.otherFacts}</p>
                <CopyBlock label={s.copy} copiedLabel={s.copied} text={`transport  Streamable HTTP\nurl        ${origin}/api/mcp\nheader     Authorization: Bearer ${tk}`} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-foreground-muted">{s.otherPrompt}</p>
                <CopyBlock wrap label={s.copy} copiedLabel={s.copied} text={selfSetupPrompt(origin, tk, lang)} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-foreground-muted">{s.otherBridge}</p>
                <CopyBlock label={s.copy} copiedLabel={s.copied} text={`npx -y mcp-remote ${origin}/api/mcp --header "Authorization:Bearer ${tk}"`} />
              </div>
            </>
          ) : (
            <>
              <p className="max-w-3xl text-xs leading-relaxed text-foreground-muted">{s.restHint}</p>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-foreground-muted">{s.restCalls}</p>
                <CopyBlock label={s.copy} copiedLabel={s.copied} text={`curl -s ${origin}/api/v1/tools -H "Authorization: Bearer ${tk}"\n\ncurl -s -X POST ${origin}/api/v1/tools/get_overview \\\n  -H "Authorization: Bearer ${tk}" -H "content-type: application/json" \\\n  -d '{"project":"sopa"}'`} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-foreground-muted">{s.restSpec}</p>
                <CopyBlock label={s.copy} copiedLabel={s.copied} text={`curl -s ${origin}/api/v1/openapi.json -H "Authorization: Bearer ${tk}"`} />
                <button type="button" onClick={() => void copySpec()} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-foreground hover:border-border-strong">
                  {specCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} {specCopied ? s.copied : s.copySpec}
                </button>
              </div>
            </>
          )}
        </div>
        {!fresh && <p className="mt-3 text-[11px] text-foreground-subtle">{s.placeholderNote}</p>}
      </section>

      <section className="rounded-2xl border border-accent-border bg-accent-bg p-4">
        <p className="text-sm font-semibold text-foreground">{s.first}</p>
        <p className="mb-3 mt-1 max-w-3xl text-xs leading-relaxed text-foreground-muted">{s.firstHint}</p>
        <CopyBlock wrap label={s.copy} copiedLabel={s.copied} text={FIRST_MESSAGE[lang]} />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-foreground">{s.ask}</p>
        <p className="mt-1 text-xs text-foreground-muted">{s.askHint}</p>
        <div className="mt-4 grid gap-x-6 gap-y-5 lg:grid-cols-2">
          {groups.filter((g) => g.examples.length).map((g) => (
            <div key={g.id}>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">{g.label[lang]}</p>
              <p className="mb-2 mt-0.5 text-[11px] text-foreground-subtle">{g.hint[lang]}</p>
              <div className="space-y-1.5">{g.examples.map((e) => <AskLine key={e.text.en} text={e.text[lang]} />)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-foreground">{s.shortcuts}</p>
        <p className="mt-1 max-w-3xl text-xs text-foreground-muted">{s.shortcutsHint}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {PROMPTS.map((p) => (
            <li key={p.name} className="rounded-lg border border-border bg-surface-elevated px-3 py-2">
              <p className="font-mono text-xs text-foreground">/mcp__sopa__{p.name}{p.args.map((x) => <span key={x.name} className="text-foreground-subtle"> {x.required ? `<${x.name}>` : `[${x.name}]`}</span>)}</p>
              <p className="mt-0.5 text-xs text-foreground-muted">{p.description[lang]}</p>
            </li>
          ))}
        </ul>
      </section>

      {catalog.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-4">
          <button type="button" onClick={() => setShowTools((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
            <span>
              <span className="block text-sm font-semibold text-foreground">{s.tools} · {catalog.length}</span>
              <span className="mt-1 block text-xs text-foreground-muted">{s.toolsHint}</span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-foreground-muted transition-transform ${showTools ? "rotate-180" : ""}`} />
          </button>
          {showTools && (
            <div className="mt-4 space-y-4">
              {groups.filter((g) => g.tools.length).map((g) => (
                <div key={g.id}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-accent">{g.label[lang]}</p>
                  <ul className="space-y-1.5">
                    {g.tools.map((t) => (
                      <li key={t.name} className="rounded-lg border border-border bg-surface-elevated px-3 py-2">
                        <p className="font-mono text-xs text-foreground">
                          {t.name}
                          {t.needsAgents && <span className="ml-2 rounded bg-accent-bg px-1.5 font-sans text-[10px] font-semibold text-accent">{s.needsAgents}</span>}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{t.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-foreground">{s.yourTokens}</p>
        {tokens === null ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-foreground-muted"><Loader2 className="h-3 w-3 animate-spin" /> …</p>
        ) : tokens.length === 0 ? (
          <p className="mt-3 text-xs text-foreground-subtle">{s.none}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {t.name}
                  {t.scopes.includes("agents") && <span className="ml-2 rounded bg-accent-bg px-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">{s.agents}</span>}
                </span>
                <span className="font-mono text-xs text-foreground-subtle">{t.prefix}…</span>
                <span className="text-xs text-foreground-subtle">{s.created} {when(t.createdAt)} · {t.lastUsedAt ? `${s.lastUsed} ${when(t.lastUsedAt)}` : s.never} · {t.calls} {s.calls}</span>
                <button type="button" onClick={() => void revoke(t.id)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger hover:bg-surface"><Trash2 className="h-3.5 w-3.5" /> {s.revoke}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
