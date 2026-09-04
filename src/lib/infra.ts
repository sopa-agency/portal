import "server-only";
import { prisma } from "@/lib/prisma";
import { ok, unread, type Reading } from "@/lib/reading";

/**
 * A infra da SOPA: as máquinas que sustentam o que a Vercel não sustenta.
 *
 * Duas fontes que respondem perguntas DIFERENTES, e por isso não se misturam:
 *
 *   · O PORTAL sabe quem bate ponto — quem está de fato publicando. Uma
 *     máquina pode estar viva no Tailscale e não estar trabalhando.
 *   · O TAILSCALE sabe quem existe na rede — inclusive máquina que nunca
 *     encostou no portal.
 *
 * Uma máquina no Tailscale e ausente do ponto não é a mesma coisa que uma
 * máquina que sumiu das duas, e o painel não pode borrar essa diferença: a
 * primeira é uma máquina ociosa, a segunda é uma máquina que caiu.
 */

/** ~6 min é a folga que o cron da Vercel usa para decidir assumir o publish. */
export const FOLGA_MS = 6 * 60_000;

export type Host = {
  hostname: string;
  lastTickAt: string;
  firstSeenAt: string;
  tickCount: number;
  /** Bateu ponto dentro da folga — está publicando agora. */
  vivo: boolean;
};

export type Frota = {
  /** epoch ms da leitura. O render é puro: ele não pergunta as horas. */
  lidoEm: number;
  hosts: Host[];
  /** O lease singleton, que existe desde antes do registro por host. */
  ultimoTickMac: string | null;
  crossPostProntoEm: string | null;
  /** O publicador não consegue gravar o resultado de volta. */
  crossPostVelho: boolean;
};

/** Quem bate ponto no portal. */
export async function lerFrota(): Promise<Reading<Frota>> {
  try {
    const [hosts, lease] = await Promise.all([
      prisma.portalHost.findMany({ orderBy: { lastTickAt: "desc" } }),
      prisma.schedulerLease.findFirst(),
    ]);
    const agora = Date.now();
    const cp = lease?.crossPostReadyAt?.getTime() ?? null;
    return ok({
      lidoEm: agora,
      crossPostVelho: cp === null ? false : agora - cp > FOLGA_MS,
      hosts: hosts.map((h) => ({
        hostname: h.hostname,
        lastTickAt: h.lastTickAt.toISOString(),
        firstSeenAt: h.firstSeenAt.toISOString(),
        tickCount: h.tickCount,
        vivo: agora - h.lastTickAt.getTime() < FOLGA_MS,
      })),
      ultimoTickMac: lease?.lastMacTickAt?.toISOString() ?? null,
      crossPostProntoEm: lease?.crossPostReadyAt?.toISOString() ?? null,
    });
  } catch (e) {
    return unread(e instanceof Error ? e.message : "o banco não respondeu");
  }
}

export type Maquina = {
  id: string;
  nome: string;
  so: string;
  versaoCliente: string;
  enderecos: string[];
  ultimaVez: string;
  online: boolean;
  /** Chaves que expiram derrubam a máquina da rede sem aviso. */
  expiraEm: string | null;
  /** Menos de 14 dias para a chave cair — e chave que cai derruba a máquina. */
  expiraLogo: boolean;
  chaveNaoExpira: boolean;
  tags: string[];
  usuario: string;
};

/**
 * As máquinas do tailnet.
 *
 * O tailnet e a chave são env porque a rede vai MUDAR de dono: hoje ela é a
 * conta pessoal do Vlad, e vira a da SOPA. Trocar tem de custar uma variável,
 * não um deploy.
 *
 * Sem chave isto NÃO devolve lista vazia. Lista vazia diria "a SOPA não tem
 * máquina nenhuma", que é uma afirmação, e o que houve foi não ter perguntado.
 */
export async function lerTailscale(): Promise<Reading<Maquina[]>> {
  const chave = process.env.TAILSCALE_API_KEY?.trim();
  const tailnet = process.env.TAILSCALE_TAILNET?.trim();
  if (!chave || !tailnet) {
    return unread(
      "TAILSCALE_API_KEY e TAILSCALE_TAILNET não estão configuradas — ninguém perguntou à rede, e isso não é o mesmo que ela estar vazia",
    );
  }
  try {
    const r = await fetch(`https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/devices`, {
      headers: { authorization: `Bearer ${chave}` },
      next: { revalidate: 120, tags: ["infra"] },
    });
    if (!r.ok) return unread(`a API do Tailscale respondeu ${r.status}`);
    const j = (await r.json()) as {
      devices?: {
        id: string; name: string; hostname: string; os: string; clientVersion: string;
        addresses: string[]; lastSeen: string; keyExpiryDisabled: boolean; expires: string;
        tags?: string[]; user: string;
      }[];
    };
    const agora = Date.now();
    // `asOf` carimba a leitura: o render não pode perguntar as horas (regra
    // react-hooks/purity), então a hora viaja junto do dado que ela data.
    return ok(
      (j.devices ?? []).map((d) => ({
        id: d.id,
        nome: d.hostname || d.name,
        so: d.os,
        versaoCliente: (d.clientVersion || "").split("-")[0],
        enderecos: d.addresses ?? [],
        ultimaVez: d.lastSeen,
        // A API não tem campo "online": o Tailscale considera visto nos
        // últimos ~5 min como conectado, e é essa a conta feita aqui.
        online: !!d.lastSeen && agora - Date.parse(d.lastSeen) < 5 * 60_000,
        expiraEm: d.keyExpiryDisabled ? null : d.expires || null,
        expiraLogo: !d.keyExpiryDisabled && !!d.expires && Date.parse(d.expires) - agora < 14 * 86_400_000,
        chaveNaoExpira: !!d.keyExpiryDisabled,
        tags: d.tags ?? [],
        usuario: d.user ?? "",
      })).sort((a, b) => Number(b.online) - Number(a.online) || a.nome.localeCompare(b.nome)),
      agora,
    );
  } catch (e) {
    return unread(e instanceof Error ? e.message : "a chamada não respondeu");
  }
}

/**
 * As duas listas viradas UM desenho, sem perder o que as separa.
 *
 * A órbita mostra cada máquina uma vez, e o ESTADO dela diz de qual lista ela
 * veio. Isso é o oposto de fundir as listas: fundir apagaria a diferença entre
 * "ociosa" e "caiu"; aqui a diferença vira a aparência de cada corpo.
 *
 *   publicando  — bate ponto: está trabalhando agora
 *   ociosa      — está na rede e não bate ponto
 *   parada      — batia ponto e parou (o ponto envelheceu)
 *
 * O casamento é por nome, normalizado: o Tailscale devolve `minivlad` e o
 * worker manda o hostname da máquina. Quem não casa aparece assim mesmo — uma
 * máquina que existe só num dos lados é justamente a que vale ver.
 */
export type Corpo = {
  nome: string;
  estado: "publicando" | "ociosa" | "parada";
  /** Bate ponto no portal. */
  bate: boolean;
  /** Existe no tailnet. */
  naRede: boolean;
  online: boolean;
  so: string | null;
  ultimoSinal: string | null;
  batidas: number | null;
};

const chave = (n: string) => n.trim().toLowerCase().split(".")[0];

export function orbita(frota: Reading<Frota>, tailscale: Reading<Maquina[]>): Corpo[] {
  const porNome = new Map<string, Corpo>();

  if (frota.state === "ok") {
    for (const h of frota.value.hosts) {
      porNome.set(chave(h.hostname), {
        nome: h.hostname,
        estado: h.vivo ? "publicando" : "parada",
        bate: true,
        naRede: false,
        online: h.vivo,
        so: null,
        ultimoSinal: h.lastTickAt,
        batidas: h.tickCount,
      });
    }
  }

  if (tailscale.state === "ok") {
    for (const m of tailscale.value) {
      const k = chave(m.nome);
      const ja = porNome.get(k);
      if (ja) {
        ja.naRede = true;
        ja.so = m.so;
        // Estar na rede não promove quem parou de bater ponto: a máquina pode
        // estar ligada e não estar publicando, e é essa a informação.
        if (!ja.bate || ja.estado === "parada") ja.online = ja.online || m.online;
        continue;
      }
      porNome.set(k, {
        nome: m.nome,
        estado: "ociosa",
        bate: false,
        naRede: true,
        online: m.online,
        so: m.so,
        ultimoSinal: m.ultimaVez,
        batidas: null,
      });
    }
  }

  const ordem = { publicando: 0, ociosa: 1, parada: 2 } as const;
  return [...porNome.values()].sort(
    (a, b) => ordem[a.estado] - ordem[b.estado] || a.nome.localeCompare(b.nome),
  );
}
