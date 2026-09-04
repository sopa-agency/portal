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
 * A topologia de verdade, que NÃO é uma órbita plana.
 *
 * A primeira versão pôs tudo em volta do portal, e estava errada: o portal não
 * fala com os dispositivos. Quem fala com ele é o Mac mini — ele bate ponto,
 * publica, e serve os proxies. Os outros aparelhos estão na rede DELE.
 *
 *   portal (Vercel)
 *      ↑  bate ponto
 *   Mac mini
 *      ↑  tailnet
 *   os outros aparelhos
 *
 * Desenhar dois níveis como um só nível achatava a hierarquia e sugeria que um
 * iPhone conversa com a Vercel, o que não acontece.
 */

/** A Tailscale planta os próprios nós de Funnel no tailnet. São 23 dos 30 aqui,
 *  não são máquinas da SOPA, e num mapa de frota eles são só ruído. */
const INFRA_DA_TAILSCALE = /^funnel-ingress-node$/i;

export type No = {
  nome: string;
  so: string | null;
  online: boolean;
  ultimoSinal: string | null;
};

export type Hub = No & {
  /** Bateu ponto dentro da folga. */
  publicando: boolean;
  batidas: number;
  /** O worker não mandou `x-scheduler-host`, então o portal não sabe o nome. */
  anonimo: boolean;
  /** Também aparece no tailnet — o casamento por nome deu certo. */
  naRede: boolean;
};

export type Topologia = {
  /** Quem bate ponto no portal. Normalmente um. */
  hubs: Hub[];
  /** O resto do tailnet, sem a infraestrutura da Tailscale e sem os hubs. */
  dispositivos: No[];
  /** Quantos nós de Funnel foram escondidos — dito, não sumido em silêncio. */
  funnelEscondidos: number;
  redeLida: boolean;
};

const chave = (n: string) => n.trim().toLowerCase().split(".")[0];

export function topologia(frota: Reading<Frota>, tailscale: Reading<Maquina[]>): Topologia {
  const rede = tailscale.state === "ok" ? tailscale.value : [];
  const funnel = rede.filter((m) => INFRA_DA_TAILSCALE.test(m.nome));
  const reais = rede.filter((m) => !INFRA_DA_TAILSCALE.test(m.nome));
  const porNome = new Map(reais.map((m) => [chave(m.nome), m]));

  const hubs: Hub[] = [];
  if (frota.state === "ok") {
    for (const h of frota.value.hosts) {
      const anonimo = h.hostname === "(sem nome)";
      const par = anonimo ? undefined : porNome.get(chave(h.hostname));
      if (par) porNome.delete(chave(h.hostname));
      hubs.push({
        nome: anonimo ? "Mac mini" : h.hostname,
        so: par?.so ?? null,
        online: h.vivo || !!par?.online,
        ultimoSinal: h.lastTickAt,
        publicando: h.vivo,
        batidas: h.tickCount,
        anonimo,
        naRede: !!par,
      });
    }
  }

  return {
    hubs,
    dispositivos: [...porNome.values()].map((m) => ({
      nome: m.nome,
      so: m.so,
      online: m.online,
      ultimoSinal: m.ultimaVez,
    })).sort((a, b) => Number(b.online) - Number(a.online) || a.nome.localeCompare(b.nome)),
    funnelEscondidos: funnel.length,
    redeLida: tailscale.state === "ok",
  };
}
