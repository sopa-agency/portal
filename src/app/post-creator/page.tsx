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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Instagram"
        title="Post Creator"
        description="Compose, preview, and publish Instagram posts — single image, carousel, or reel."
      />
      <PostCreator agentName={project.agent.displayName} igHandle={igHandle} />
    </div>
  );
}
