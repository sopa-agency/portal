// Registra o proposer do portal como DELEGATE de um Safe no Safe Transaction
// Service da Arbitrum — o registro é por rede, e o da Base/mainnet não vale lá.
//
// Quem roda é um DONO do Safe naquela rede, com a própria chave, na própria
// máquina. O portal nunca vê essa chave; este script também não a guarda.
//
//   SAFE_OWNER_PRIVATE_KEY=0x… node scripts/safe-delegate-arbitrum.mjs <safe> [rótulo]
//
// Ex.: SAFE_OWNER_PRIVATE_KEY=0x… node scripts/safe-delegate-arbitrum.mjs 0x96C37393B79aD7EABdF9Ccf82C2EDAd3d3c0eEA2 "SOPA PROPOSER"
//
// O delegate é o endereço do SAFE_PROPOSER_PRIVATE_KEY (0x5f437B3A…3cef); passa
// outro em DELEGATE=0x… se precisar. Depois, conferir em
// https://safe-transaction-arbitrum.safe.global/api/v2/delegates/?safe=<safe>

import { privateKeyToAccount } from "viem/accounts";
import { getAddress, isAddress } from "viem";

const CHAIN_ID = 42161;
const SERVICE = "https://safe-transaction-arbitrum.safe.global";
const DELEGATE = process.env.DELEGATE ?? "0x5f437B3A74B1d5a1beC34b2be380343F6F3a3cef";

const [safeArg, label = "SOPA PROPOSER"] = process.argv.slice(2);
const pk = process.env.SAFE_OWNER_PRIVATE_KEY?.trim();
if (!safeArg || !isAddress(safeArg)) {
  console.error("uso: SAFE_OWNER_PRIVATE_KEY=0x… node scripts/safe-delegate-arbitrum.mjs <safe> [rótulo]");
  process.exit(2);
}
if (!pk) {
  console.error("falta SAFE_OWNER_PRIVATE_KEY (a chave de um DONO do Safe na Arbitrum)");
  process.exit(2);
}

const safe = getAddress(safeArg);
const delegate = getAddress(DELEGATE);
const owner = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

// EIP-712 do serviço (v2): Delegate { delegateAddress, totp }, totp = hora atual
// inteira. A assinatura vale só nesta hora — não dá para reaproveitar.
const totp = Math.floor(Date.now() / 1000 / 3600);
const signature = await owner.signTypedData({
  domain: { name: "Safe Transaction Service", version: "1.0", chainId: CHAIN_ID },
  types: { Delegate: [{ name: "delegateAddress", type: "address" }, { name: "totp", type: "uint256" }] },
  primaryType: "Delegate",
  message: { delegateAddress: delegate, totp: BigInt(totp) },
});

console.log(`Safe      ${safe}`);
console.log(`delegate  ${delegate}`);
console.log(`delegator ${owner.address} (a sua chave; tem de ser dono do Safe na Arbitrum)`);

const r = await fetch(`${SERVICE}/api/v2/delegates/`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ safe, delegate, delegator: owner.address, label, signature }),
});
const body = await r.text();
console.log(`HTTP ${r.status} ${body.slice(0, 300)}`);
if (!r.ok) process.exit(1);

const check = await (await fetch(`${SERVICE}/api/v2/delegates/?safe=${safe}`)).json();
console.log("delegates agora:", (check.results ?? []).map((d) => `${d.delegate} (${d.label})`).join(", ") || "nenhum");
