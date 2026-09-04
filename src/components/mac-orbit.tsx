import type { Corpo } from "@/lib/infra";

/**
 * A órbita dos Mac minis em volta do portal.
 *
 * ── Por que DESENHADO e não a foto ─────────────────────────────────────────
 * A foto do Mac mini que veio de referência mora no CDN da loja de outra
 * pessoa. Apontar para lá cria três problemas de uma vez: a imagem some no dia
 * em que a loja mexer no catálogo, o Next precisa do host em `remotePatterns`
 * (que é um card aberto e não publicado nesta base), e uma foto de produto não
 * tem tema — ela fica igual no claro e no escuro, e neste portal tudo tem os
 * dois. Um SVG resolve os três: não depende de ninguém, é nítido em qualquer
 * tamanho, e usa os tokens de cor como o resto da tela.
 *
 * ── O que o desenho DIZ ─────────────────────────────────────────────────────
 * O estado de cada corpo vem das DUAS listas sem fundi-las (ver infra.ts):
 *   publicando — bate ponto, linha cheia até o portal, LED aceso
 *   ociosa     — está na rede e não trabalha, linha tracejada, LED apagado
 *   parada     — batia ponto e parou, linha pontilhada, corpo esmaecido
 *
 * Fundir as listas apagaria a diferença entre "ociosa" e "caiu", que é a única
 * coisa que este painel existe para mostrar. Aqui ela virou aparência.
 */

const COR = {
  publicando: "var(--success)",
  ociosa: "var(--foreground-faint)",
  parada: "var(--warning)",
} as const;

const TRACO = { publicando: undefined, ociosa: "5 6", parada: "2 6" } as const;

/** Um Mac mini de frente: chassi de alumínio, base escura e o LED. */
function MacMini({ x, y, s, estado }: { x: number; y: number; s: number; estado: Corpo["estado"] }) {
  const w = s;
  const h = s * 0.62;
  const aceso = estado === "publicando";
  return (
    <g transform={`translate(${x - w / 2} ${y - h / 2})`}>
      {/* sombra sob o corpo — dá o volume que a silhueta sozinha não dá */}
      <ellipse cx={w / 2} cy={h + 3} rx={w * 0.42} ry={2.5} fill="var(--foreground)" opacity={0.1} />
      {/* chassi */}
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={h * 0.28}
        className="fill-[var(--surface-elevated)]"
        stroke={estado === "parada" ? "var(--warning)" : "var(--border-strong)"}
        strokeWidth={1.4}
        opacity={estado === "ociosa" ? 0.72 : 1}
      />
      {/* o brilho no topo — alumínio pega luz por cima, e sem isto o chassi
          fica chapado e some no fundo */}
      <rect x={w * 0.06} y={h * 0.1} width={w * 0.88} height={h * 0.16} rx={h * 0.08}
        fill="var(--foreground)" opacity={0.05} />
      {/* a faixa escura da base, que é o que faz ele parecer um Mac mini e não
          uma caixa qualquer */}
      <path
        d={`M ${h * 0.05} ${h * 0.68} H ${w - h * 0.05} v ${h * 0.08} a ${h * 0.24} ${h * 0.24} 0 0 1 -${h * 0.24} ${h * 0.24} H ${h * 0.29} a ${h * 0.24} ${h * 0.24} 0 0 1 -${h * 0.24} -${h * 0.24} Z`}
        fill="var(--foreground)"
        opacity={0.22}
      />
      {/* o LED, no canto de sempre */}
      <circle cx={w * 0.16} cy={h * 0.5} r={Math.max(1.6, s * 0.045)} fill={aceso ? "var(--success)" : "var(--foreground-faint)"} opacity={aceso ? 1 : 0.5}>
        {aceso && <animate attributeName="opacity" values="1;0.35;1" dur="2.6s" repeatCount="indefinite" />}
      </circle>
    </g>
  );
}

export function MacOrbit({ corpos, redeLida }: { corpos: Corpo[]; redeLida: boolean }) {
  if (corpos.length === 0) return null;

  const W = 760;
  const H = 340;
  const cx = W / 2;
  const cy = H / 2 - 4;
  // Raio em X maior que em Y: a órbita é uma elipse deitada, que é como se
  // desenha profundidade sem perspectiva de verdade — e sobra largura na tela,
  // não altura.
  const raioX = W * 0.33;
  const raioY = H * 0.32;
  const tam = corpos.length > 8 ? 54 : corpos.length > 5 ? 66 : 80;

  // Começa no topo e distribui. Ângulo fixo por índice: a lista já vem ordenada
  // por estado no servidor, então quem publica ocupa sempre o mesmo lugar entre
  // duas visitas — órbita que embaralha a cada render não é um mapa, é ruído.
  // Com uma ou duas máquinas, começar no topo joga as duas no eixo ESTREITO da
  // elipse, empilhadas — a órbita fica alta e magra num card largo. Começando
  // na direita elas ocupam o eixo largo, que é onde há espaço.
  const inicio = corpos.length <= 2 ? 0 : -Math.PI / 2;
  const pos = corpos.map((c, i) => {
    const a = inicio + (i * 2 * Math.PI) / corpos.length;
    return { c, x: cx + raioX * Math.cos(a), y: cy + raioY * Math.sin(a) };
  });

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 600 }} role="img"
        aria-label={`${corpos.length} máquinas em volta do portal`}>
        {/* o anel da órbita */}
        <ellipse cx={cx} cy={cy} rx={raioX} ry={raioY} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="3 7" />

        {/* as linhas: cada uma diz como aquela máquina se relaciona com o portal */}
        {pos.map(({ c, x, y }) => (
          <line key={`l-${c.nome}`} x1={cx} y1={cy} x2={x} y2={y}
            stroke={COR[c.estado]} strokeWidth={c.estado === "publicando" ? 2 : 1.2}
            strokeOpacity={c.estado === "publicando" ? 0.5 : 0.28}
            strokeDasharray={TRACO[c.estado]} />
        ))}

        {/* o portal, no centro */}
        <circle cx={cx} cy={cy} r={48} className="fill-[var(--surface-elevated)]" stroke="var(--accent)" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={48} fill="none" stroke="var(--accent)" strokeWidth={16} strokeOpacity={0.1} />
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontSize: 15, fontWeight: 600 }}>portal</text>
        <text x={cx} y={cy + 15} textAnchor="middle" className="fill-[var(--foreground-faint)]" style={{ fontSize: 11 }}>Vercel</text>

        {pos.map(({ c, x, y }) => (
          <g key={c.nome}>
            <title>{[
              c.nome,
              c.estado === "publicando" ? "publicando agora" : c.estado === "ociosa" ? "na rede, sem bater ponto" : "batia ponto e parou",
              c.so ? `sistema: ${c.so}` : null,
              c.batidas != null ? `${c.batidas.toLocaleString("pt-BR")} batidas` : null,
              c.naRede ? "no Tailscale" : "fora do Tailscale (ou a rede não foi lida)",
            ].filter(Boolean).join("\n")}</title>
            <MacMini x={x} y={y} s={tam} estado={c.estado} />
            <text x={x} y={y + tam * 0.52 + 14} textAnchor="middle"
              className="fill-[var(--foreground-muted)]" style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace" }}>
              {c.nome.length > 16 ? `${c.nome.slice(0, 15)}…` : c.nome}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-foreground-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--success)" }} /> publicando
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--foreground-faint)" }} /> na rede, ociosa
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--warning)" }} /> parou de bater ponto
        </span>
        {!redeLida && (
          <span className="text-warning">
            — a rede não foi lida, então só aparecem as máquinas que batem ponto
          </span>
        )}
      </div>
    </div>
  );
}
