import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { AboutDeck } from "@/components/about-deck";

export const dynamic = "force-dynamic";

// Gated to the SOPA portal (project.about + slug). The deck itself lives in
// components/about-deck, and its copy in the dictionary — a second project
// would key its own content by slug from here.
export default async function AboutPage() {
  const project = await getActiveProject();
  if (!project.about || project.slug !== "sopa") notFound();

  // Read on the server so the year can't differ between the two renders.
  return <AboutDeck year={new Date().getFullYear()} />;
}
