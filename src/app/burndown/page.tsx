import { notFound } from "next/navigation";
import { ExternalLink, Flame, FlaskConical, GitBranch, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section-heading";
import { getActiveProject } from "@/projects/index";
import { isOk } from "@/lib/reading";
import { BURNDOWN, TETO_HONESTO, lerRepo, lerMockup } from "@/lib/burndown";

export const dynamic = "force-dynamic";

// en-US porque o portal é travado em inglês: uma data em pt-BR no meio de uma
// frase em inglês é o tipo de meia-tradução que faz o resto parecer descuido.
const quando = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dias = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/** As perguntas que a cadeia ainda não respondeu, na ordem do quanto podem matar. */
const ABERTAS = [
  {
    id: "E1",
    mata: true,
    titulo: "Does Doppler accept a Token-2022 quote mint?",
    corpo:
      "The whole premise depends on it, and it is UNVERIFIED. The SDK offers no Token-2022 quote preset (launchTokenPrograms.token2022Base() still sets TOKEN_PROGRAM_ADDRESS), every unit test uses an SPL-Token quote, and the Rust is closed. Fail ⇒ Doppler cannot host this product as specified — and then it gets re-run on Meteora DBC before anyone concludes it is impossible.",
  },
  {
    id: "E2",
    mata: true,
    titulo: "What breaks when a transfer hook goes live on the quote mint?",
    corpo:
      "Expected: everything reverts and liquidity is stranded. Decides whether xStocks pairs can ever be offered safely, or whether a wrapper/escrow layer is required first.",
  },
  {
    id: "E3",
    mata: false,
    titulo: "Is protocolFeeBps snapshotted at launch?",
    corpo:
      `Strongly inferred, never proven. It is what decides whether "${TETO_HONESTO}% forever" is a promise we can keep, or only a measurement of today.`,
  },
  {
    id: "E4",
    mata: false,
    titulo: "Who can call cpmm::set_fees on a migrated pool?",
    corpo:
      "If the CPMM admin can cut feeSplitBps after migration, the harvestable stream shrinks even though the split is honoured.",
  },
  {
    id: "E5b",
    mata: false,
    titulo: "Does the burn crank's swap work with a Token-2022 quote?",
    corpo:
      "Resolved on pool shape, open on execution. The crank buys against the launch's own base/quote pool, so the shape exists by construction — what is missing is seeing it run.",
  },
];

/** O que a cadeia JÁ respondeu. Registrar o que não é problema vale tanto quanto o que é. */
const FECHADAS = [
  ["Is Doppler's 7.50% waivable for a partner?", "REFUTED — no per-launch or per-integrator override exists."],
  ["Does the burn promise silently stop at migration?", "REFUTED — the beneficiary policy survives migration."],
  ["Is the quote constrained to WSOL?", "REFUTED — the quote is a free parameter."],
  ["Is the incinerator a burn?", "CONFIRMED that it is not. A real burn is an spl_token::burn CPI — and Doppler does neither."],
  ["xStocks: T2022 transfer hook initialized but disabled?", "CONFIRMED, and worse than reported."],
];

/** Os números que só existem depois do lançamento. Nenhum deles é zero hoje. */
const AINDA_NAO = [
  ["Tokens launched", "no program on chain"],
  ["Active equity pairs", "the marketplace is a mockup"],
  ["Policy chosen · burn vs split", "nothing deployed"],
  ["Volume traded", "no real pool"],
  ["Fees burned", "burn needs our own program, not written yet"],
];

export default async function BurnDownPage() {
  const project = await getActiveProject();
  // A flag guarda o MENU; sem isto ela não guardaria a rota, e a mesma tela
  // responderia por URL direta em todo portal — inclusive nos que acabaram de
  // deixar de mostrá-la. É o mesmo portão que /about, /portfolio e /org-chart
  // já usam.
  if (!project.burnDown) notFound();
  const [repo, mockup] = await Promise.all([lerRepo(), lerMockup()]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={project.name}
        title="BurnDownWallStreet"
        description="A Solana token launcher and marketplace where every launched token is paired against a tokenized equity, and the fee policy is chosen once, at deploy, and is then immutable on chain."
      />

      {/* ── O teto honesto ──
          Vem primeiro porque é o fato que define o produto, e porque é o fato
          que um painel de projeto novo mais gostaria de esconder. A própria
          home do produto diz isso; a nossa não vai dizer menos. */}
      <section className="overflow-hidden rounded-2xl border border-danger/40 bg-surface">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-border bg-danger/10 px-5 py-5">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-danger">
              <Flame className="h-3 w-3" /> The honest ceiling
            </p>
            <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-foreground">{TETO_HONESTO}%</p>
            <p className="text-xs text-foreground-muted">of fees, at most</p>
          </div>
          <p className="min-w-[18rem] flex-1 text-sm leading-relaxed text-foreground-muted">
            Doppler takes <strong className="text-foreground">7.50% of every trading fee</strong> before anyone
            else, and that cut is <strong className="text-foreground">not waivable</strong> — no per-launch or
            per-integrator override exists. So{" "}
            <strong className="text-danger">there is no configuration in which &ldquo;100% of fees burned&rdquo; is true</strong>.
            Confirmed on chain, not from docs: Doppler&rsquo;s Solana fee page is an empty stub and the programs are
            closed source.
          </p>
        </div>
        <p className="px-5 py-3 text-[11px] leading-relaxed text-foreground-subtle">
          And there is a second consequence that changes the roadmap:{" "}
          <strong className="text-foreground">burning requires our own program</strong>. Doppler has no burn anywhere,
          and the incinerator is not a burn on a Token-2022 asset — a real burn is an{" "}
          <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[10px]">spl_token::burn</code>.
        </p>
      </section>

      {/* ── Fase ── */}
      <Section title="Where the project stands" hint="phase 0 · research and design done, nothing on chain">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">Phase</p>
            <p className="mt-1 text-lg font-semibold text-foreground">0 — working mockup</p>
            <p className="mt-1 text-[11px] leading-relaxed text-foreground-subtle">
              Runs locally, no chain calls. Everything below <code className="font-mono">MarketSource</code> is
              mocked, and the deploy button is deliberately dead.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">Last commit</p>
            {isOk(repo) ? (
              <>
                <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {dias(repo.value.ultimoPush)} day{dias(repo.value.ultimoPush) === 1 ? "" : "s"} ago
                </p>
                <p className="mt-1 font-mono text-[11px] text-foreground-subtle">
                  {quando(repo.value.ultimoPush)} · {repo.value.branchPadrao}
                  {repo.value.privado ? " · private repo" : ""}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-warning">
                ⚠ Could not read the repository — {repo.state === "unread" ? repo.reason : repo.note}. This does NOT
                mean it is idle.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">Mockup online</p>
            {isOk(mockup) ? (
              <>
                <p className={`mt-1 text-lg font-semibold ${mockup.value.status < 400 ? "text-success" : "text-warning"}`}>
                  HTTP {mockup.value.status}
                </p>
                <a
                  href={BURNDOWN.mockup}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex max-w-full items-center gap-1 break-all font-mono text-[11px] text-accent hover:underline"
                >
                  burndownwallstreet.vercel.app <ExternalLink className="h-3 w-3" />
                </a>
              </>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-warning">
                ⚠ Could not reach the mockup — {mockup.state === "unread" ? mockup.reason : mockup.note}. This does
                NOT mean it is down.
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* ── As perguntas abertas ── */}
      <Section title="What the chain has not answered yet" hint="ordered by how much each one can kill">
        <ul className="space-y-2">
          {ABERTAS.map((q) => (
            <li
              key={q.id}
              className={`rounded-2xl border bg-surface p-4 ${q.mata ? "border-danger/40" : "border-border"}`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                    q.mata ? "bg-danger/15 text-danger" : "bg-surface-elevated text-foreground-muted"
                  }`}
                >
                  {q.id}
                </span>
                <span className="text-sm font-semibold text-foreground">{q.titulo}</span>
                {q.mata && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-danger">
                    <TriangleAlert className="h-3 w-3" /> can kill the product
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-foreground-muted">{q.corpo}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* ── O que já foi respondido ── */}
      <Section title="What the chain already answered" hint="decoded from mainnet, not read from docs">
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {FECHADAS.map(([p, r]) => (
            <li key={p} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="min-w-[16rem] flex-1 text-xs text-foreground-muted">{p}</span>
              <span className="text-xs font-medium text-foreground">{r}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-foreground-subtle">
          Doppler&rsquo;s Solana programs are closed source and its fee page is an empty stub — none of this came from
          documentation. It was decoded from the SDK-generated codecs plus on-chain account state.
        </p>
      </Section>

      {/* ── O que ainda não existe ──
          A parte mais importante do painel. Cada uma destas linhas seria um
          zero num dashboard comum, e um zero aqui afirmaria que o produto
          rodou e não rendeu — quando o que houve é que ele ainda não rodou. */}
      <Section title="What does not exist yet" hint="none of these is a zero — it is an absence">
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-dashed border-border-strong bg-surface-elevated">
          {AINDA_NAO.map(([rot, motivo]) => (
            <li key={rot} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="min-w-[14rem] flex-1 text-xs font-medium text-foreground">{rot}</span>
              <span className="font-mono text-lg text-foreground-faint">—</span>
              <span className="text-[11px] text-foreground-subtle">{motivo}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ── Onde as coisas estão ── */}
      <Section title="Where things live">
        <div className="flex flex-wrap gap-2">
          {[
            { rot: "Repository", url: `https://github.com/${BURNDOWN.repo}`, icone: GitBranch },
            { rot: "Mockup", url: BURNDOWN.mockup, icone: ExternalLink },
            { rot: "Doppler research", url: `https://github.com/${BURNDOWN.repo}/tree/main/research`, icone: FlaskConical },
            { rot: "Open questions", url: `https://github.com/${BURNDOWN.repo}/blob/main/research/OPEN-QUESTIONS.md`, icone: FlaskConical },
            { rot: "Design spec", url: `https://github.com/${BURNDOWN.repo}/blob/main/design/REGISTRY-SPEC.md`, icone: GitBranch },
          ].map(({ rot, url, icone: Icone }) => (
            <a
              key={rot}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground"
            >
              <Icone className="h-3.5 w-3.5" /> {rot} <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}
