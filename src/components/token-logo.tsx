// Token + chain logos copied into /public/tokens. Anything without a logo falls
// back to a colored monogram so the UI never shows a broken image.

const TOKEN_LOGOS: Record<string, string> = {
  USDC: "/tokens/usdc.png",
  ETH: "/tokens/eth.svg",
  WETH: "/tokens/eth.svg",
  HIVE: "/tokens/hive.png",
  HP: "/tokens/hp.png",
  HBD: "/tokens/hbd.svg",
  "HBD SAVINGS": "/tokens/hbd.svg",
  DEGEN: "/tokens/degen.png",
  HIGHER: "/tokens/higher.png",
  ZORA: "/tokens/zora.svg",
  GNARS: "/tokens/gnars.png",
  NOG: "/tokens/nog.png",
  NOGS: "/tokens/nog.png",
};

const CHAIN_LOGOS: Record<string, string> = {
  base: "/tokens/base.png",
  ethereum: "/tokens/eth.svg",
  eth: "/tokens/eth.svg",
};

export function tokenLogo(symbol: string): string | null {
  return TOKEN_LOGOS[symbol.trim().toUpperCase()] ?? null;
}
export function chainLogo(chain: string): string | null {
  return CHAIN_LOGOS[chain.trim().toLowerCase()] ?? null;
}

export function TokenLogo({
  symbol,
  size = 28,
  color = "#94a3b8",
  className = "",
}: {
  symbol: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const src = tokenLogo(symbol);
  const dim = { width: size, height: size };
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={symbol}
        style={dim}
        className={`shrink-0 rounded-full bg-surface-elevated object-contain ring-1 ring-border ${className}`}
      />
    );
  }
  return (
    <span
      style={{ ...dim, backgroundColor: color }}
      className={`flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${className}`}
      aria-hidden
    >
      {symbol.slice(0, 3).toUpperCase()}
    </span>
  );
}
