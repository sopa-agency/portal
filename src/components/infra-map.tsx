import type { Topologia } from "@/lib/infra";

/**
 * O mapa da infra, em DOIS níveis — porque a rede tem dois.
 *
 * A primeira versão pôs tudo em volta do portal e estava errada: o portal não
 * fala com um iPhone. Quem fala com ele é o Mac mini — ele bate ponto, publica
 * e serve os proxies. Os outros aparelhos estão no tailnet DELE.
 *
 *   portal (Vercel)  ←  Mac mini  ←  os outros aparelhos
 *
 * Achatar os dois níveis num só sugeria uma conversa que não existe.
 *
 * ── Por que desenhado, e não a foto ────────────────────────────────────────
 * A foto de referência mora no CDN da loja de outra pessoa: some no dia em que
 * ela mexer no catálogo, exige o host em `remotePatterns`, e não tem tema —
 * ficaria igual no claro e no escuro, num portal onde tudo tem os dois.
 */

/** Um Mac mini de frente: chassi de alumínio, base escura e o LED. */
function MacMini({ s, aceso }: { s: number; aceso: boolean }) {
  const w = s;
  const h = s * 0.62;
  return (
    <>
      <ellipse cx={w / 2} cy={h + 3} rx={w * 0.42} ry={2.5} fill="var(--foreground)" opacity={0.1} />
      <rect x={0} y={0} width={w} height={h} rx={h * 0.28}
        className="fill-[var(--surface-elevated)]" stroke="var(--border-strong)" strokeWidth={1.4} />
      <rect x={w * 0.06} y={h * 0.1} width={w * 0.88} height={h * 0.16} rx={h * 0.08}
        fill="var(--foreground)" opacity={0.05} />
      <path
        d={`M ${h * 0.05} ${h * 0.68} H ${w - h * 0.05} v ${h * 0.08} a ${h * 0.24} ${h * 0.24} 0 0 1 -${h * 0.24} ${h * 0.24} H ${h * 0.29} a ${h * 0.24} ${h * 0.24} 0 0 1 -${h * 0.24} -${h * 0.24} Z`}
        fill="var(--foreground)" opacity={0.22} />
      <circle cx={w * 0.16} cy={h * 0.5} r={Math.max(1.8, s * 0.045)}
        fill={aceso ? "var(--success)" : "var(--foreground-faint)"} opacity={aceso ? 1 : 0.5}>
        {aceso && <animate attributeName="opacity" values="1;0.35;1" dur="2.6s" repeatCount="indefinite" />}
      </circle>
    </>
  );
}

/** Um aparelho qualquer, desenhado pelo que ele É — telefone, laptop ou caixa. */
function Aparelho({ s, so, online }: { s: number; so: string | null; online: boolean }) {
  const op = online ? 1 : 0.45;
  const traco = online ? "var(--border-strong)" : "var(--foreground-faint)";
  const sis = (so ?? "").toLowerCase();
  if (sis.includes("ios") || sis.includes("android")) {
    // telefone
    return (
      <g opacity={op}>
        <rect x={s * 0.28} y={0} width={s * 0.44} height={s * 0.82} rx={s * 0.1}
          className="fill-[var(--surface-elevated)]" stroke={traco} strokeWidth={1.2} />
        <rect x={s * 0.38} y={s * 0.06} width={s * 0.24} height={s * 0.035} rx={s * 0.02} fill="var(--foreground)" opacity={0.25} />
      </g>
    );
  }
  if (sis.includes("mac")) {
    // laptop: tampa + base, o suficiente para não ser confundido com o mini
    return (
      <g opacity={op}>
        <rect x={s * 0.14} y={0} width={s * 0.72} height={s * 0.48} rx={s * 0.05}
          className="fill-[var(--surface-elevated)]" stroke={traco} strokeWidth={1.2} />
        <path d={`M ${s * 0.04} ${s * 0.52} H ${s * 0.96} l -${s * 0.06} ${s * 0.09} H ${s * 0.1} Z`} fill={traco} opacity={0.5} />
      </g>
    );
  }
  // linux / windows / desconhecido — uma caixa, honestamente genérica
  return (
    <g opacity={op}>
      <rect x={s * 0.12} y={s * 0.06} width={s * 0.76} height={s * 0.62} rx={s * 0.07}
        className="fill-[var(--surface-elevated)]" stroke={traco} strokeWidth={1.2} />
      <circle cx={s * 0.24} cy={s * 0.55} r={s * 0.035} fill={online ? "var(--success)" : "var(--foreground-faint)"} />
    </g>
  );
}

export function InfraMap({ topo }: { topo: Topologia }) {
  const { hubs, dispositivos, funnelEscondidos, redeLida } = topo;
  if (hubs.length === 0 && dispositivos.length === 0) return null;

  const W = 780;
  // A altura acompanha o que há para desenhar: sem aparelhos, o arco de baixo
  // não existe, e reservar espaço para ele deixaria metade do card vazio — o
  // que faz parecer que algo não carregou.
  const H = dispositivos.length > 0 ? 470 : 300;
  const cx = W / 2;
  const yPortal = 52;
  const yHub = 190;
  const hubSize = 88;
  // Os aparelhos ficam num arco ABAIXO do hub, não num anel completo: um anel
  // fechado passaria por cima da linha que sobe para o portal, e cruzar a linha
  // que carrega o sentido do desenho é o jeito mais rápido de perdê-lo.
  const raioX = W * 0.4;
  const raioY = 150;
  const yArco = yHub + 46;
  const n = dispositivos.length;
  const apSize = n > 10 ? 34 : n > 6 ? 42 : 50;

  const posAp = dispositivos.map((d, i) => {
    // arco de 200° a 340° (a metade de baixo), sobrando o topo para o portal
    const a = ((200 + (n === 1 ? 70 : (i * 140) / (n - 1))) * Math.PI) / 180;
    return { d, x: cx + raioX * Math.cos(a), y: yArco - raioY * Math.sin(a) };
  });

  const hubX = (i: number) => (hubs.length === 1 ? cx : cx + (i - (hubs.length - 1) / 2) * (hubSize + 70));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 620 }} role="img"
        aria-label={`${hubs.length} máquina(s) ligada(s) ao portal e ${dispositivos.length} aparelhos na rede delas`}>

        {/* ── as linhas primeiro, para ficarem sob os corpos ── */}
        {hubs.map((h, i) => (
          <line key={`p-${h.nome}`} x1={cx} y1={yPortal + 34} x2={hubX(i)} y2={yHub - hubSize * 0.34}
            stroke={h.publicando ? "var(--success)" : "var(--warning)"} strokeWidth={h.publicando ? 2.2 : 1.4}
            strokeOpacity={h.publicando ? 0.6 : 0.4} strokeDasharray={h.publicando ? undefined : "3 6"} />
        ))}
        {posAp.map(({ d, x, y }) => (
          <line key={`h-${d.nome}`} x1={hubX(0)} y1={yHub + hubSize * 0.34} x2={x} y2={y}
            stroke="var(--foreground-faint)" strokeWidth={1} strokeOpacity={d.online ? 0.3 : 0.14}
            strokeDasharray="4 6" />
        ))}

        {/* ── o portal ── */}
        <circle cx={cx} cy={yPortal} r={34} className="fill-[var(--surface-elevated)]" stroke="var(--accent)" strokeWidth={2} />
        <circle cx={cx} cy={yPortal} r={34} fill="none" stroke="var(--accent)" strokeWidth={12} strokeOpacity={0.1} />
        <text x={cx} y={yPortal - 1} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontSize: 13, fontWeight: 600 }}>portal</text>
        <text x={cx} y={yPortal + 13} textAnchor="middle" className="fill-[var(--foreground-faint)]" style={{ fontSize: 10 }}>Vercel</text>

        {/* ── o(s) Mac mini(s) que batem ponto ── */}
        {hubs.map((h, i) => (
          <g key={h.nome}>
            <title>{[
              h.nome,
              h.publicando ? "publicando agora" : "batia ponto e parou",
              `${h.batidas.toLocaleString("pt-BR")} batidas`,
              h.anonimo ? "o worker não manda x-scheduler-host, então o portal não sabe o nome" : null,
              h.naRede ? "também no tailnet" : "não casou com nenhuma máquina do tailnet",
            ].filter(Boolean).join("\n")}</title>
            <g transform={`translate(${hubX(i) - hubSize / 2} ${yHub - hubSize * 0.31})`}>
              <MacMini s={hubSize} aceso={h.publicando} />
            </g>
            <text x={hubX(i)} y={yHub + hubSize * 0.46} textAnchor="middle"
              className={h.anonimo ? "fill-[var(--foreground-faint)]" : "fill-[var(--foreground)]"}
              style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--font-geist-mono), monospace" }}>
              {h.nome}
            </text>
            <text x={hubX(i)} y={yHub + hubSize * 0.46 + 14} textAnchor="middle"
              className="fill-[var(--foreground-faint)]" style={{ fontSize: 10 }}>
              {h.publicando ? "publicando" : "ponto velho"}
            </text>
          </g>
        ))}

        {/* ── os aparelhos do tailnet ── */}
        {posAp.map(({ d, x, y }) => (
          <g key={d.nome}>
            <title>{[d.nome, d.so ?? "sistema desconhecido", d.online ? "online" : "offline"].join("\n")}</title>
            <g transform={`translate(${x - apSize / 2} ${y - apSize / 2})`}>
              <Aparelho s={apSize} so={d.so} online={d.online} />
            </g>
            <text x={x} y={y + apSize * 0.62 + 10} textAnchor="middle"
              className="fill-[var(--foreground-faint)]" style={{ fontSize: 9.5, fontFamily: "var(--font-geist-mono), monospace" }}>
              {d.nome.length > 14 ? `${d.nome.slice(0, 13)}…` : d.nome}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-foreground-faint">
        <span>
          <strong className="text-foreground">{hubs.length}</strong> ligada{hubs.length === 1 ? "" : "s"} ao portal ·{" "}
          <strong className="text-foreground">{dispositivos.length}</strong> na rede dela
          {hubs.length === 1 ? "" : "s"}
        </span>
        {/* Escondido é dito, não sumido: um número que cai de 30 para 7 sem
            explicação parece perda de dado. */}
        {funnelEscondidos > 0 && (
          <span>
            {funnelEscondidos} nós de Funnel da Tailscale fora do desenho — são infraestrutura dela, não máquinas da SOPA
          </span>
        )}
        {!redeLida && <span className="text-warning">— a rede não foi lida, então só aparece quem bate ponto</span>}
      </div>
    </div>
  );
}
