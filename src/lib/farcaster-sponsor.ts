import "server-only";
import { mnemonicToAccount } from "viem/accounts";
import QRCode from "qrcode";

// Sponsored managed-signer minting for the Settings "Conectar meu Farcaster"
// QR flow. A dedicated SPONSOR Farcaster account (FARCASTER_SPONSOR_MNEMONIC /
// _FID) signs each SignedKeyRequest; the team member approves the resulting
// deep link in THEIR OWN Warpcast — they never share a recovery phrase.
//
// SECURITY: the sponsor seed controls only the ability to *request* signers
// (which each user must still approve), so use a throwaway sponsor account, not
// a valuable brand account. The seed is read server-side and never returned.

const SIGNED_KEY_REQUEST_VALIDATOR = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553" as const,
};
const SIGNED_KEY_REQUEST_TYPE = [
  { name: "requestFid", type: "uint256" },
  { name: "key", type: "bytes" },
  { name: "deadline", type: "uint256" },
] as const;

export function sponsorConfigured(): boolean {
  return !!process.env.FARCASTER_SPONSOR_MNEMONIC?.trim() && !!process.env.FARCASTER_SPONSOR_FID?.trim();
}

function engineApiKey(): string | undefined {
  // The signer is created + later used with this key. Use a PAID key (e.g.
  // gnars') if you want member LIKES to work (reactions are a paid feature).
  return process.env.FARCASTER_SPONSOR_API_KEY?.trim() || process.env.NEYNAR_API_KEY?.trim();
}

async function neynar(method: string, path: string, apiKey: string, body?: unknown) {
  const res = await fetch(`https://api.neynar.com${path}`, {
    method,
    headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json: json as Record<string, unknown> };
}

export type MintedSigner = { signerUuid: string; approvalUrl: string; qrDataUrl: string };

/** Create a managed signer + sponsor-signed approval link + a QR data URL. */
export async function mintMemberSigner(): Promise<
  { ok: true; data: MintedSigner } | { ok: false; error: string }
> {
  const mnemonic = process.env.FARCASTER_SPONSOR_MNEMONIC?.trim();
  const fidRaw = process.env.FARCASTER_SPONSOR_FID?.trim();
  const apiKey = engineApiKey();
  if (!mnemonic || !fidRaw || !apiKey) return { ok: false, error: "Sponsor não configurado (FARCASTER_SPONSOR_MNEMONIC / _FID)." };
  const sponsorFid = Number(fidRaw);
  if (!Number.isFinite(sponsorFid)) return { ok: false, error: "FARCASTER_SPONSOR_FID inválido." };

  const account = mnemonicToAccount(mnemonic);

  const created = await neynar("POST", "/v2/farcaster/signer", apiKey);
  const signerUuid = created.json?.signer_uuid as string | undefined;
  const publicKey = created.json?.public_key as string | undefined;
  if (!created.ok || !signerUuid || !publicKey) {
    return { ok: false, error: `Neynar /signer falhou (HTTP ${created.status}).` };
  }

  const deadline = Math.floor(Date.now() / 1000) + 86400; // 24h
  const signature = await account.signTypedData({
    domain: SIGNED_KEY_REQUEST_VALIDATOR,
    types: { SignedKeyRequest: SIGNED_KEY_REQUEST_TYPE },
    primaryType: "SignedKeyRequest",
    message: { requestFid: BigInt(sponsorFid), key: publicKey as `0x${string}`, deadline: BigInt(deadline) },
  });

  const reg = await neynar("POST", "/v2/farcaster/signer/signed_key", apiKey, {
    signer_uuid: signerUuid,
    app_fid: sponsorFid,
    deadline,
    signature,
  });
  const approvalUrl = reg.json?.signer_approval_url as string | undefined;
  if (!reg.ok || !approvalUrl) {
    return { ok: false, error: `Neynar /signed_key falhou (HTTP ${reg.status}).` };
  }

  const qrDataUrl = await QRCode.toDataURL(approvalUrl, { width: 320, margin: 2 });
  return { ok: true, data: { signerUuid, approvalUrl, qrDataUrl } };
}

/** Poll a signer; returns approved status + fid/handle when done. */
export async function checkSignerStatus(
  signerUuid: string,
): Promise<{ status: string; fid?: number; handle?: string }> {
  const apiKey = engineApiKey();
  if (!apiKey) return { status: "error" };
  const r = await neynar("GET", `/v2/farcaster/signer?signer_uuid=${encodeURIComponent(signerUuid)}`, apiKey);
  const status = (r.json?.status as string) ?? "unknown";
  const fid = r.json?.fid as number | undefined;
  let handle: string | undefined;
  if (status === "approved" && fid) {
    const u = await neynar("GET", `/v2/farcaster/user/bulk?fids=${fid}`, apiKey);
    const users = u.json?.users as { username?: string }[] | undefined;
    handle = users?.[0]?.username;
  }
  return { status, fid, handle };
}
