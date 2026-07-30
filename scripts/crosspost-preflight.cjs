#!/usr/bin/env node
// Pre-flight for the Instagram cross-post curation queue.
//
// The portal's queries were written against a WRITTEN SPEC of the SkateHive
// app's tables, never against the live schema. This checks every assumption
// before a curator hits a 500 in production. Read-only, except one notification
// insert that is deleted immediately — the only way to prove the write path
// works without waiting for a real rejection to discover it doesn't.
//
//   npx dotenv -e .env.local -- node scripts/crosspost-preflight.cjs
//   npx dotenv -e .env.local -- node scripts/crosspost-preflight.cjs --read-only
//
// --read-only pula o teste de escrita. Use quando não quiser tocar em
// userbase_notifications de jeito nenhum — o insert é apagado em seguida, mas
// ele existe por um instante para um usuário real.
//
// Uses SUPABASE_USERBASE_URL + SUPABASE_USERBASE_SERVICE_ROLE_KEY, the same
// credentials the feature runs on.

const { createClient } = require("@supabase/supabase-js");

const QUEUE = "userbase_crosspost_queue";
const NOTIF = "userbase_notifications";

// Every column the portal reads or writes. A missing one is an immediate 500.
const QUEUE_COLUMNS = [
  "id", "user_id", "requested_by_handle", "target", "hive_author", "hive_permlink",
  "status", "payload", "reviewed_by_handle", "reviewed_at", "review_note",
  "attempts", "published_at", "publish_error", "result", "created_at", "updated_at",
];
const NOTIF_COLUMNS = ["user_id", "type", "title", "body", "link", "metadata"];

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => { failures++; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };
const info = (m) => console.log(`  \x1b[2m·\x1b[0m ${m}`);

async function main() {
  const url = process.env.SUPABASE_USERBASE_URL;
  const key = process.env.SUPABASE_USERBASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("\nSUPABASE_USERBASE_URL / SUPABASE_USERBASE_SERVICE_ROLE_KEY não estão setados.\n");
    process.exit(1);
  }
  const readOnly = process.argv.includes("--read-only");
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  console.log(`\nProjeto: \x1b[1m${url}\x1b[0m\n`);

  // --- the queue table ------------------------------------------------------
  console.log(QUEUE);
  const probe = await sb.from(QUEUE).select(QUEUE_COLUMNS.join(",")).limit(1);
  if (probe.error) {
    bad(`não consegui ler as colunas esperadas: ${probe.error.message}`);
    info("PostgREST diz qual coluna faltou na mensagem acima");
  } else {
    ok(`as ${QUEUE_COLUMNS.length} colunas existem e são legíveis`);
  }

  // --- the notifications table ---------------------------------------------
  console.log(`\n${NOTIF}`);
  const nprobe = await sb.from(NOTIF).select(NOTIF_COLUMNS.join(",")).limit(1);
  if (nprobe.error) bad(`não consegui ler: ${nprobe.error.message}`);
  else ok(`as ${NOTIF_COLUMNS.length} colunas existem e são legíveis`);

  // --- the write path -------------------------------------------------------
  // A rejection that silently fails to notify is the exact bug this catches.
  console.log("\nEscrita de teste");
  if (readOnly) {
    info("pulado (--read-only) — rode sem a flag para validar o caminho de escrita");
  } else {
  const sample = await sb
    .from(QUEUE)
    .select("id,user_id")
    .eq("target", "instagram")
    .limit(1)
    .maybeSingle();

  if (sample.error) {
    bad(`não consegui buscar uma linha de exemplo: ${sample.error.message}`);
  } else if (!sample.data) {
    info("nenhuma linha de instagram na fila — ligue o CROSSPOST_QUEUE_ENABLED no app");
  } else {
    const upd = await sb
      .from(QUEUE)
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sample.data.id)
      .select("id");
    if (upd.error) bad(`UPDATE na fila falhou: ${upd.error.message}`);
    else if (!upd.data?.length) bad("UPDATE não retornou linha — RLS ou filtro bloqueando?");
    else ok("UPDATE na fila funciona");

    if (sample.data.user_id) {
      const ins = await sb
        .from(NOTIF)
        .insert({
          user_id: sample.data.user_id,
          type: "crosspost_preflight",
          title: "preflight",
          body: "preflight",
          link: null,
          metadata: { preflight: true },
        })
        .select("id");
      if (ins.error) {
        bad(`INSERT de notificação falhou: ${ins.error.message}`);
        info("colunas NOT NULL sem default que o portal não preenche costumam ser a causa");
      } else {
        ok("INSERT de notificação funciona");
        const id = ins.data?.[0]?.id;
        if (id) {
          const del = await sb.from(NOTIF).delete().eq("id", id);
          if (del.error) bad(`não consegui apagar a notificação de teste (id=${id}) — apague à mão`);
          else info("notificação de teste apagada");
        } else {
          info("insert não devolveu id — confira se sobrou uma notificação 'crosspost_preflight'");
        }
      }
    } else {
      info("linha de exemplo sem user_id — INSERT de notificação não testado");
    }
  }

  }

  // --- what's in the queue --------------------------------------------------
  console.log("\nConteúdo da fila");
  const all = await sb.from(QUEUE).select("target,status");
  if (all.error) {
    info(`não consegui contar: ${all.error.message}`);
  } else {
    const counts = new Map();
    for (const r of all.data ?? []) {
      const k = `${r.target} / ${r.status}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (counts.size === 0) info("vazia");
    else [...counts.entries()].sort().forEach(([k, n]) => info(`${k}: ${n}`));

    const orphan = (all.data ?? []).filter(
      (r) => r.target === "farcaster" && r.status === "pending_review",
    ).length;
    if (orphan > 0) {
      bad(`${orphan} pedido(s) de Farcaster em pending_review — o portal cura só Instagram, ` +
          `então ninguém vai olhar pra eles`);
    }
  }

  console.log(
    failures === 0
      ? "\n\x1b[32mTudo certo.\x1b[0m Pode testar com um handle canário.\n"
      : `\n\x1b[31m${failures} problema(s).\x1b[0m Resolva antes de ligar em produção.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nNão consegui rodar: ${err.message}\n`);
  process.exit(1);
});
