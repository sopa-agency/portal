import "server-only";
import { prisma } from "@/lib/prisma";
import { GLOBAL_ALLOWLIST } from "@/lib/auth";

/** projectSlug que significa "todos os portais" na tabela TeamMember. */
const GLOBAL_SLUG = "*";
import { getAllProjects } from "@/projects/index";
import { mergeContacts, resolveCrossPortalContacts } from "@/lib/team-messaging";
import type { ProjectConfig, TeamContact } from "@/projects/types";

// Registro central da equipe. A fonte única de "quem está na equipe e como se
// fala com a pessoa", reusada em várias telas (aba Team, Reuniões, …).
//
// A LISTA VEM DA MESMA REGRA QUE DECIDE QUEM ENTRA, e isso é o ponto.
//
// Antes ela vinha do `allowlist` do config — um array no código. Só que quem
// ENTRA é decidido pelo `getAccess`, que lê a tabela TeamMember. As duas
// respostas divergiram em silêncio: quem foi adicionado pelo painel (ou por
// SQL) tinha acesso, usava o portal, e não existia na aba Team. Medido no dia
// em que isso apareceu: 6 pessoas invisíveis — jasperopr em oito portais,
// willyogo e 0xigami no gnars, beaglexv na sopa, r4topunk no vlad.
//
// Não é só cosmético: quem não está na lista não tem perfil para editar, não
// aparece em Reuniões e não recebe mensagem da equipe. A pessoa existe para o
// login e não existe para o time.
//
// Agora a regra é a MESMA do getAccess, deliberadamente:
//   portal semeado (tem linha no banco) -> o banco manda
//   portal sem linha nenhuma            -> cai no allowlist do config
// mais os admins globais, que vêm das duas fontes (código e banco).
//
// Contatos continuam mesclando config + linhas do banco resolvidas ENTRE todos
// os portais (valor digitado num portal vale nos outros, o atual ganha) — ver
// resolveCrossPortalContacts.

export type RosterMember = {
  username: string;
  avatarUrl: string;
  /**
   * Whether the Hive account actually set a profile picture. images.hive.blog
   * answers 200 with a generic silhouette for accounts that never did, so an
   * <img> can't tell the difference — only the account metadata can.
   */
  hasAvatar: boolean;
  profileUrl: string;
  /** First contact labelled "Email" (validated), or null. */
  email: string | null;
  contacts: TeamContact[];
  /** True para admins de todos os portais — do código E do banco. */
  global: boolean;
};

const _avatarCache = new Map<string, boolean>();
let _avatarCacheExpires = 0;
const AVATAR_TTL_MS = 60 * 60 * 1000;

/**
 * Which of these Hive accounts set a profile picture, batched into one RPC.
 * On any failure every name comes back `true` — showing the account's real
 * avatar when we're unsure beats replacing good photos with initials.
 */
async function fetchHasAvatar(usernames: string[]): Promise<Map<string, boolean>> {
  const now = Date.now();
  if (now > _avatarCacheExpires) {
    _avatarCache.clear();
    _avatarCacheExpires = now + AVATAR_TTL_MS;
  }
  const missing = usernames.filter((u) => !_avatarCache.has(u));
  if (missing.length) {
    try {
      const res = await fetch(process.env.HIVE_API_URL || "https://api.hive.blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "condenser_api.get_accounts",
          params: [missing],
          id: 1,
        }),
        cache: "no-store",
      });
      const json = (await res.json()) as {
        result?: { name: string; posting_json_metadata?: string; json_metadata?: string }[];
      };
      // Accounts the node didn't return stay unknown, so default them to true.
      for (const u of missing) _avatarCache.set(u, true);
      for (const acc of json.result ?? []) {
        let image: string | undefined;
        // Newer clients write posting_json_metadata; older ones json_metadata.
        for (const key of ["posting_json_metadata", "json_metadata"] as const) {
          try {
            const profile = JSON.parse(acc[key] || "{}")?.profile;
            if (profile?.profile_image) { image = String(profile.profile_image); break; }
          } catch {}
        }
        _avatarCache.set(acc.name, !!image?.trim());
      }
    } catch {
      for (const u of missing) _avatarCache.set(u, true);
    }
  }
  return new Map(usernames.map((u) => [u, _avatarCache.get(u) ?? true]));
}

/** Hive serves every avatar from the same path, so the URL needs no lookup —
 *  only the "did they ever set one?" answer does. */
export function hiveAvatarUrl(username: string): string {
  return `https://images.hive.blog/u/${username}/avatar`;
}

/**
 * Whether a single Hive account has a real profile picture.
 *
 * Exists because Hive answers 200 with a generic silhouette for accounts that
 * never set one, so an <img> onError handler cannot tell the two apart — the
 * question has to be asked of the API.
 *
 * Callers on a hot path should persist the answer rather than ask per render.
 */
export async function resolveHasAvatar(username: string): Promise<boolean> {
  return (await fetchHasAvatar([username])).get(username) ?? true;
}

export async function getTeamRoster(project: ProjectConfig): Promise<RosterMember[]> {
  const [projectRows, globalRows] = await Promise.all([
    prisma.teamMember
      .findMany({ where: { projectSlug: project.slug }, select: { username: true } })
      .catch(() => [] as { username: string }[]),
    prisma.teamMember
      .findMany({ where: { projectSlug: GLOBAL_SLUG }, select: { username: true } })
      .catch(() => [] as { username: string }[]),
  ]);

  // Mesma regra do getAccess: semeado -> banco manda; vazio -> config.
  const seeded = projectRows.length > 0;
  const base = seeded ? projectRows.map((r) => r.username) : project.allowlist;

  const globalSet = new Set([
    ...GLOBAL_ALLOWLIST,
    ...globalRows.map((r) => r.username.toLowerCase()),
  ]);
  const globals = [...globalSet].filter((u) => !base.includes(u));
  const usernames = [...new Set([...base, ...globals])];
  const rows = await prisma.teamMemberContact
    .findMany({ where: { username: { in: usernames } } })
    .catch(() => [] as { projectSlug: string; username: string; label: string; value: string; updatedAt: Date }[]);
  const byUser = resolveCrossPortalContacts(rows, project.slug);
  const frontend = project.hive.frontend ?? "https://peakd.com";
  const hasAvatar = await fetchHasAvatar(usernames);
  return usernames.map((username) => {
    const contacts = mergeContacts(project.teamContacts?.[username] ?? [], byUser.get(username) ?? []);
    const emailRaw = contacts.find((c) => c.label.toLowerCase() === "email")?.value?.trim();
    return {
      username,
      avatarUrl: hiveAvatarUrl(username),
      hasAvatar: hasAvatar.get(username) ?? true,
      profileUrl: `${frontend}/@${username}`,
      email: emailRaw && /@/.test(emailRaw) ? emailRaw.toLowerCase() : null,
      contacts,
      global: globalSet.has(username),
    };
  });
}

/** Roster members that have a usable email (for invites / availability). */
export async function getTeamEmails(project: ProjectConfig): Promise<{ username: string; email: string }[]> {
  const roster = await getTeamRoster(project);
  return roster.flatMap((m) => (m.email ? [{ username: m.username, email: m.email }] : []));
}

/**
 * Em quais portais cada pessoa entra — pelo banco, um mapa de uma vez só.
 *
 * A versão anterior era síncrona e lia o `allowlist` do config, então mostrava
 * a lista errada pela mesma razão do roster. E como é chamada por membro, uma
 * consulta por pessoa seria N consultas: aqui vem tudo numa e vira mapa.
 */
export async function getPortalsByUser(): Promise<Map<string, { slug: string; name: string }[]>> {
  const [rows, counts] = await Promise.all([
    prisma.teamMember.findMany({ select: { projectSlug: true, username: true } }).catch(() => []),
    prisma.teamMember
      .groupBy({ by: ["projectSlug"], _count: { projectSlug: true } })
      .catch(() => [] as { projectSlug: string; _count: { projectSlug: number } }[]),
  ]);
  const seeded = new Set(
    counts.filter((c) => c._count.projectSlug > 0).map((c) => c.projectSlug),
  );
  const projects = getAllProjects();
  const globals = new Set([
    ...GLOBAL_ALLOWLIST,
    ...rows.filter((r) => r.projectSlug === GLOBAL_SLUG).map((r) => r.username.toLowerCase()),
  ]);

  const byUser = new Map<string, { slug: string; name: string }[]>();
  const add = (u: string, p: { slug: string; name: string }) => {
    const list = byUser.get(u) ?? [];
    if (!list.some((x) => x.slug === p.slug)) list.push(p);
    byUser.set(u, list);
  };

  for (const p of projects) {
    const entry = { slug: p.slug, name: p.name };
    // Semeado: quem entra é quem está no banco. Sem linha nenhuma: o config.
    const members = seeded.has(p.slug)
      ? rows.filter((r) => r.projectSlug === p.slug).map((r) => r.username.toLowerCase())
      : p.allowlist.map((u) => u.toLowerCase());
    for (const u of members) add(u, entry);
    for (const u of globals) add(u, entry);
  }
  return byUser;
}

/**
 * Em quais portais UMA pessoa entra. Mesma regra do getAccess, de novo.
 *
 * É o que o seletor de portais da barra lateral precisa. Ele filtrava pelo
 * `allowlist` do config, então quem foi adicionado pelo banco entrava no portal
 * pela URL e não via o menu para trocar — tinha o acesso e não tinha a porta.
 */
export async function accessiblePortalSlugs(username: string): Promise<Set<string>> {
  const u = username.toLowerCase();
  const [rows, counts] = await Promise.all([
    prisma.teamMember
      .findMany({ where: { username: u }, select: { projectSlug: true } })
      .catch(() => [] as { projectSlug: string }[]),
    prisma.teamMember
      .groupBy({ by: ["projectSlug"], _count: { projectSlug: true } })
      .catch(() => [] as { projectSlug: string; _count: { projectSlug: number } }[]),
  ]);

  const all = getAllProjects();
  if (rows.some((r) => r.projectSlug === GLOBAL_SLUG) || GLOBAL_ALLOWLIST.includes(u)) {
    return new Set(all.map((p) => p.slug));
  }

  const seeded = new Set(
    counts.filter((c) => c._count.projectSlug > 0).map((c) => c.projectSlug),
  );
  const mine = new Set(rows.map((r) => r.projectSlug));
  const out = new Set<string>();
  for (const p of all) {
    const ok = seeded.has(p.slug) ? mine.has(p.slug) : p.allowlist.includes(u);
    if (ok) out.add(p.slug);
  }
  return out;
}
