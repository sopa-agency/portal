import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { listBoard } from "@/app/actions/sopa-boards";
import { SopaPortfolio } from "@/components/sopa-portfolio";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const project = await getActiveProject();
  if (!project.portfolio || project.slug !== "sopa") notFound();
  const cards = await listBoard("portfolio");
  return <SopaPortfolio initial={cards} />;
}
