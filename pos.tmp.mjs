import { createPublicClient, http, formatUnits } from "viem";
import { base, mainnet } from "viem/chains";
const MS = "0xC1afA4c0A70B622d7b71d42241Bb4d52B6F3E218";
const pad = MS.slice(2).toLowerCase().padStart(64, "0");

// 1) cofre USDC da SOPA, na Base
const b = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
const VAULT = "0x3A36a1cc8Dc914D22b1Fd823695a0f4f737bCbD8";
const sh = await b.call({ to: VAULT, data: `0x70a08231${pad}` }).catch(() => null);
const shares = sh?.data && sh.data !== "0x" ? BigInt(sh.data) : 0n;
let assets = 0n;
if (shares > 0n) {
  const r = await b.call({ to: VAULT, data: `0x07a2d13a${shares.toString(16).padStart(64, "0")}` }).catch(() => null);
  assets = r?.data ? BigInt(r.data) : 0n;
}
console.log(`cofre USDC da SOPA (Base ${VAULT.slice(0,10)}…)`);
console.log(`   shares ${formatUnits(shares, 18)}  ->  ${formatUnits(assets, 6)} USDC`);

// 2) Morpheus capital (stETH) na mainnet — contrato de Distribution classico
const m = createPublicClient({ chain: mainnet, transport: http("https://gateway.tenderly.co/public/mainnet") });
const DIST = "0x47176B2Af9885dC6C4575d4eFd63895f7Aaa4790";
console.log(`\nMorpheus Distribution (mainnet ${DIST.slice(0,10)}…) — usersData(user, poolId)`);
for (const poolId of [0, 1]) {
  const data = `0xb1ea1e01${poolId.toString(16).padStart(64, "0")}${pad}`;
  const r = await m.call({ to: DIST, data }).catch((e) => ({ err: String(e.message).slice(0, 60) }));
  if (r.err) { console.log(`   pool ${poolId}: ${r.err}`); continue; }
  const hex = r.data ?? "0x";
  if (hex.length < 2 + 64 * 2) { console.log(`   pool ${poolId}: resposta curta`); continue; }
  const deposited = BigInt("0x" + hex.slice(2 + 64, 2 + 64 * 2));
  console.log(`   pool ${poolId}: deposited = ${formatUnits(deposited, 18)} stETH`);
}
