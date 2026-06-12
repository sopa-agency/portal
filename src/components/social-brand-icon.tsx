// Tiny inline brand marks for the social platforms. Brand colors are
// deliberately hardcoded (see AGENTS.md) with shades that read on both
// themes; X uses currentColor so it flips black/white with the theme.

export function SocialBrandIcon({
  platform,
  className = "h-3.5 w-3.5",
}: {
  platform: string;
  className?: string;
}) {
  const p = platform.toLowerCase();
  if (p === "instagram") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="#E1306C" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="4.4" stroke="#E1306C" strokeWidth="2.2" />
        <circle cx="17.4" cy="6.6" r="1.5" fill="#E1306C" />
      </svg>
    );
  }
  if (p === "hive") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="#E31337" aria-hidden>
        <path d="M11.18 2.5 5.6 12l5.58 9.5h2.1L7.7 12l5.58-9.5h-2.1Z" />
        <path d="M15.86 4.7 11.57 12l4.29 7.3h2.1L13.67 12l4.29-7.3h-2.1Z" opacity=".75" />
        <path d="M19.3 7.6 16.72 12l2.58 4.4h1.7L18.42 12 21 7.6h-1.7Z" opacity=".5" />
      </svg>
    );
  }
  if (p === "farcaster") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="#855DCD" aria-hidden>
        <path d="M5 4h14v3h-1.5v13h-3.8v-7.2a3.7 3.7 0 0 0-7.4 0V20H2.5V7H5V4Z" transform="translate(1.25 0)" />
      </svg>
    );
  }
  if (p === "facebook") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="#1877F2" aria-hidden>
        <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06C2 17.08 5.66 21.24 10.44 22v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33V22C18.34 21.24 22 17.08 22 12.06Z" />
      </svg>
    );
  }
  if (p === "x") {
    return (
      <svg viewBox="0 0 24 24" className={`${className} text-foreground`} fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
      </svg>
    );
  }
  return null;
}
