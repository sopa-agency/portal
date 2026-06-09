import "server-only";
import type { ProjectConfig } from "@/projects/types";

export type ConnectionStatus = "connected" | "warning" | "manual" | "missing" | "na";

export type PortalConnection = {
  network: string;
  handle?: string;
  status: ConnectionStatus;
  detail: string;
  fixHint?: string;
};

export function getPortalConnections(project: ProjectConfig): PortalConnection[] {
  const prefix = project.agent.gatewayEnvPrefix;

  /** Has the value via namespaced key OR bare global key (trimmed, non-empty). */
  function has(key: string): boolean {
    return !!(process.env[`${prefix}_${key}`] ?? process.env[key])?.trim();
  }

  /** Has the value ONLY via the namespaced key (not global fallback). */
  function hasOwn(key: string): boolean {
    return !!process.env[`${prefix}_${key}`]?.trim();
  }

  const connections: PortalConnection[] = [];

  // ── Hive (posting) ────────────────────────────────────────────────────────
  {
    const postingAccount =
      process.env[`${prefix}_HIVE_POSTING_ACCOUNT`]?.trim() ?? project.hive.account;
    const handle = `@${postingAccount}`;

    if (hasOwn("HIVE_POSTING_KEY")) {
      connections.push({
        network: "Hive",
        handle,
        status: "connected",
        detail: `Posting as ${handle} using the project-specific key.`,
      });
    } else if (process.env["HIVE_POSTING_KEY"]?.trim()) {
      // Global key exists
      if (prefix === "SKATEHIVE") {
        connections.push({
          network: "Hive",
          handle,
          status: "connected",
          detail: `Posting as ${handle} (global key is the SkateHive key — this is correct).`,
        });
      } else {
        connections.push({
          network: "Hive",
          handle,
          status: "warning",
          detail: `Falling back to the shared global key — would post as the global account, not @${project.hive.account}.`,
          fixHint: `Set ${prefix}_HIVE_POSTING_ACCOUNT + ${prefix}_HIVE_POSTING_KEY`,
        });
      }
    } else {
      connections.push({
        network: "Hive",
        handle,
        status: "missing",
        detail: "No Hive posting key found.",
        fixHint: `Set ${prefix}_HIVE_POSTING_KEY (and ${prefix}_HIVE_POSTING_ACCOUNT if different from the project default)`,
      });
    }
  }

  // ── Farcaster ─────────────────────────────────────────────────────────────
  {
    const hasFarcasterSocial = project.socials.some(
      (s) => s.platform.toLowerCase() === "farcaster",
    );

    if (!hasFarcasterSocial) {
      connections.push({
        network: "Farcaster",
        status: "na",
        detail: "Farcaster is not configured for this project.",
      });
    } else {
      const apiKeyPresent = has("NEYNAR_API_KEY");
      const farcasterHandle =
        project.socials.find((s) => s.platform.toLowerCase() === "farcaster")?.handle ??
        `@${project.hive.account}`;

      if (!apiKeyPresent) {
        connections.push({
          network: "Farcaster",
          handle: farcasterHandle,
          status: "missing",
          detail: "No Neynar API key found.",
          fixHint: `Set ${prefix}_NEYNAR_API_KEY or NEYNAR_API_KEY`,
        });
      } else {
        // Determine signer key name to check
        const signerEnvKey = project.farcaster.signerEnvKey;
        const hasOwnSigner = signerEnvKey
          ? !!process.env[signerEnvKey]?.trim()
          : hasOwn("NEYNAR_SIGNER_UUID");

        if (hasOwnSigner) {
          connections.push({
            network: "Farcaster",
            handle: farcasterHandle,
            status: "connected",
            detail: `Casting as ${farcasterHandle} using a project-specific Neynar signer.`,
          });
        } else if (process.env["NEYNAR_SIGNER_UUID"]?.trim()) {
          if (prefix === "SKATEHIVE") {
            connections.push({
              network: "Farcaster",
              handle: farcasterHandle,
              status: "connected",
              detail: `Casting as ${farcasterHandle} (global signer is the SkateHive signer — this is correct).`,
            });
          } else {
            connections.push({
              network: "Farcaster",
              handle: farcasterHandle,
              status: "warning",
              detail: `Uses the shared global signer — not the @${project.hive.account} identity.`,
              fixHint: `Set ${prefix}_NEYNAR_SIGNER_UUID`,
            });
          }
        } else {
          connections.push({
            network: "Farcaster",
            handle: farcasterHandle,
            status: "missing",
            detail: "Neynar API key is present but no signer UUID found.",
            fixHint: `Set ${prefix}_NEYNAR_SIGNER_UUID`,
          });
        }
      }
    }
  }

  // ── Instagram ─────────────────────────────────────────────────────────────
  {
    const igSocial = project.socials.find(
      (s) => s.platform.toLowerCase() === "instagram",
    );

    if (!igSocial && !has("INSTAGRAM_ACCESS_TOKEN") && !has("INSTAGRAM_BUSINESS_ACCOUNT_ID")) {
      connections.push({
        network: "Instagram",
        status: "na",
        detail: "Instagram is not configured for this project.",
      });
    } else {
      const tokenPresent = has("INSTAGRAM_ACCESS_TOKEN");
      const accountPresent = has("INSTAGRAM_BUSINESS_ACCOUNT_ID");
      const igHandle = igSocial?.handle;

      if (tokenPresent && accountPresent) {
        connections.push({
          network: "Instagram",
          handle: igHandle,
          status: "connected",
          detail: "Access token and business account ID are both set.",
        });
      } else {
        connections.push({
          network: "Instagram",
          handle: igHandle,
          status: "missing",
          detail: `Missing: ${[!tokenPresent && "access token", !accountPresent && "business account ID"].filter(Boolean).join(" and ")}.`,
          fixHint: `Set ${prefix}_INSTAGRAM_ACCESS_TOKEN + ${prefix}_INSTAGRAM_BUSINESS_ACCOUNT_ID`,
        });
      }
    }
  }

  // ── X / Twitter ───────────────────────────────────────────────────────────
  {
    const xSocial = project.socials.find(
      (s) => s.platform.toLowerCase() === "x" || s.platform.toLowerCase() === "twitter",
    );
    connections.push({
      network: "X / Twitter",
      handle: xSocial?.handle,
      status: "manual",
      detail: "Posts via the X composer (intent) — no API auto-post.",
    });
  }

  // ── Discord ───────────────────────────────────────────────────────────────
  {
    connections.push({
      network: "Discord",
      status: "manual",
      detail: `Posted by this project's agent (${project.agent.displayName}) — connection status cannot be verified from here.`,
    });
  }

  // ── Email (SMTP) ──────────────────────────────────────────────────────────
  {
    const smtpPresent = has("SMTP_HOST");
    const emailUserPresent = has("EMAIL_USER");
    const emailPassPresent = has("EMAIL_PASS");

    if (smtpPresent && emailUserPresent && emailPassPresent) {
      connections.push({
        network: "Email (SMTP)",
        status: "connected",
        detail: "SMTP is configured (host, user, and password are all set).",
      });
    } else {
      connections.push({
        network: "Email (SMTP)",
        status: "missing",
        detail: `Missing: ${[!smtpPresent && "SMTP_HOST", !emailUserPresent && "EMAIL_USER", !emailPassPresent && "EMAIL_PASS"].filter(Boolean).join(", ")}.`,
        fixHint: `Set SMTP_HOST / EMAIL_USER / EMAIL_PASS (or ${prefix}_ prefixed)`,
      });
    }
  }

  // ── Analytics (GA4 / GSC) ─────────────────────────────────────────────────
  {
    const ga4 = project.analytics?.ga4PropertyId;
    const gsc = project.analytics?.gscSiteUrl;

    if (ga4 || gsc) {
      const parts = [ga4 && `GA4 property ${ga4}`, gsc && `GSC site ${gsc}`].filter(Boolean);
      connections.push({
        network: "Analytics",
        status: "connected",
        detail: `Configured: ${parts.join(", ")}.`,
      });
    } else {
      connections.push({
        network: "Analytics",
        status: "na",
        detail: "No GA4 or Search Console configuration for this project.",
      });
    }
  }

  return connections;
}
