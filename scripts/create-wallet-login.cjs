/**
 * Cria a tabela WalletLogin e SEMEIA a primeira allowlist.
 *
 * `prisma db push` derrapa neste banco (drift pré-existente em InstagramPost),
 * então tabela nova entra à mão — mesmo caminho de ChatConversation e
 * TreasuryBalanceCache. Tudo aqui é ADITIVO.
 *
 * A SEMENTE, e por que ela é segura
 *
 * A primeira leva vem dos contatos `Wallet` da página Team. Esse campo é
 * editável por qualquer membro do portal, e por isso ele NÃO pode ser lido pelo
 * login — um membro poria o próprio endereço no cadastro de um admin e entraria
 * como ele. O que ele pode fazer é servir de PONTO DE PARTIDA, uma vez, sob
 * auditoria: antes de semear, este script confere quem escreveu cada linha e
 * RECUSA a semear qualquer uma que tenha sido escrita por um terceiro que não
 * seja admin. Uma linha assim não é cadastro, é um endereço que alguém colocou
 * no nome de outra pessoa — e é exatamente o caso que o login não pode aceitar.
 *
 * Daí em diante nada mais entra por aqui: cada endereço novo é adicionado à mão
 * e precisa ser DESBLOQUEADO num segundo gesto.
 *
 * Rodar uma vez por ambiente:
 *   dotenv -e .env.local -- node scripts/create-wallet-login.cjs
 *   dotenv -e .env.local -- node scripts/create-wallet-login.cjs --dry
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/** Quem pode ter preenchido o cadastro de outra pessoa sem invalidar a semente. */
const ADMINS = ["xvlad"];
const DRY = process.argv.includes("--dry");

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WalletLogin" (
      "id"          TEXT PRIMARY KEY,
      "address"     TEXT NOT NULL UNIQUE,
      "username"    TEXT NOT NULL,
      "enabled"     BOOLEAN NOT NULL DEFAULT false,
      "source"      TEXT NOT NULL DEFAULT 'manual',
      "addedBy"     TEXT NOT NULL,
      "lastLoginAt" TIMESTAMP(3),
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WalletLogin_username_idx" ON "WalletLogin" ("username");
  `);
  console.log("tabela WalletLogin ok");

  const contatos = await prisma.teamMemberContact.findMany({
    where: { label: "Wallet" },
    select: { username: true, value: true, updatedBy: true },
  });

  // Um endereço = uma pessoa. Se o mesmo endereço aparece em dois cadastros,
  // ninguém sabe quem está entrando — e "ninguém sabe" num login significa
  // "entra o primeiro que o banco devolver".
  const porEndereco = new Map();
  for (const c of contatos) {
    const addr = (c.value || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) {
      console.log(`  PULA ${c.username}: "${c.value}" não é endereço EVM`);
      continue;
    }
    if (!porEndereco.has(addr)) porEndereco.set(addr, []);
    porEndereco.get(addr).push(c);
  }

  let semeados = 0;
  for (const [addr, linhas] of porEndereco) {
    if (linhas.length > 1) {
      console.log(`  RECUSA ${addr}: cadastrado por ${linhas.map((l) => l.username).join(" e ")} — ambíguo`);
      continue;
    }
    const [c] = linhas;
    const dono = c.username.toLowerCase();
    const autor = (c.updatedBy || "").toLowerCase();
    if (autor && autor !== dono && !ADMINS.includes(autor)) {
      console.log(`  RECUSA ${dono}: cadastro escrito por @${autor}, que não é a pessoa nem admin`);
      continue;
    }
    if (DRY) {
      console.log(`  semearia ${dono} ${addr} (por @${autor || "?"})`);
      semeados++;
      continue;
    }
    const existe = await prisma.walletLogin.findUnique({ where: { address: addr } });
    if (existe) {
      console.log(`  já existe ${dono} ${addr}`);
      continue;
    }
    await prisma.walletLogin.create({
      data: { address: addr, username: dono, enabled: true, source: "seed", addedBy: `seed:${autor || "?"}` },
    });
    console.log(`  semeado ${dono} ${addr}`);
    semeados++;
  }
  console.log(DRY ? `\n${semeados} seriam semeados (nada gravado)` : `\n${semeados} semeados`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
