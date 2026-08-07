import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { PostCreator } from "@/components/post-creator";

export const dynamic = "force-dynamic";

export default async function PostCreatorPage() {
  const project = await getActiveProject();

  if (!project.postCreator) {
    notFound();
  }

  const igChannel = project.socials.find(
    (c) => c.platform.toLowerCase() === "instagram",
  );
  const igHandle = igChannel?.handle ?? `@${project.slug}`;

  // Studio card-overlay templates: full set for SkateHive, the POIDH bounty
  // template for Gnars, none elsewhere.
  const cardStyles =
    project.slug === "skatehive"
      ? (["holo", "pixel", "gold"] as const)
      : project.slug === "gnars"
        ? (["skatecard", "bounty"] as const)
        : ([] as const);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Instagram"
        title="Post Creator"
        description="Compose, preview, and publish Instagram posts — single image, carousel, or reel."
      />
      <PostCreator
        agentName={project.agent.displayName}
        igHandle={igHandle}
        projectSlug={project.slug}
        cardStyles={[...cardStyles]}
        brandName={project.name}
        brandAccent={project.theme.accentDark}
        brandLogo={project.theme.logo}
        spotStudio={project.slug === "skatehive"}
      />
    </div>
  );
}
