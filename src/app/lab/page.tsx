import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { PostLab, type LabBrand } from "@/components/post-lab";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const project = await getActiveProject();
  if (!project.lab) notFound();

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

  return <PostLab brand={brand} />;
}
