import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { listUnifiedCalendar } from "@/app/actions/post-creator";
import { getLabInsights } from "@/app/actions/lab";
import { PostLab, type LabBrand } from "@/components/post-lab";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const project = await getActiveProject();
  if (!project.lab) notFound();

  // Real unified calendar (IG posts + scheduled tweets + nested projects).
  const cal = await listUnifiedCalendar().catch(() => null);
  const calendarEvents = cal?.ok ? cal.events : [];

  // The project's latest AI insights — turn one into a post.
  const insights = await getLabInsights().catch(() => []);

  // Everything the channel previews need to render accurately for this tenant.
  const brand: LabBrand = {
    projectName: project.name,
    accent: project.theme.accentDark,
    logo: project.theme.logo,
    instagramHandle:
      project.socials.find((s) => s.platform.toLowerCase() === "instagram")?.handle ??
      `@${project.slug}`,
    hiveAccount: project.hive.account,
    hiveFrontend: project.hive.frontend ?? "https://peakd.com",
    farcasterChannel: project.farcaster.channel,
  };

  // Studio card-overlay templates: full set for SkateHive, the POIDH bounty
  // template for Gnars, none elsewhere (same mapping as the Post Creator).
  const cardStyles =
    project.slug === "skatehive"
      ? (["holo", "pixel", "gold"] as const)
      : project.slug === "gnars"
        ? (["skatecard", "bounty"] as const)
        : ([] as const);

  return (
    <PostLab
      brand={brand}
      calendarEvents={calendarEvents}
      activeSlug={project.slug}
      insights={insights}
      hasRepo={(project.repos?.length ?? 0) > 0}
      cardStyles={[...cardStyles]}
    />
  );
}
