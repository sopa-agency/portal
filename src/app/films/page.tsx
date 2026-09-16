import { notFound } from "next/navigation";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FilmStudio } from "@/components/films/film-studio";
import { loadFilmScenes, loadFilmTexts } from "@/app/actions/films";
import { getActiveProject } from "@/projects";

export const dynamic = "force-dynamic";

// /films — estúdio de filmes de feature, ligado por `project.films`. O playbook
// (docs/filmes-de-feature.md) é lido do repositório em runtime e abre num
// painel dentro do estúdio; next.config inclui o arquivo no bundle da Vercel.
export default async function FilmsPage() {
  const project = await getActiveProject();
  if (!project.films) notFound();
  const playbook = await fs.readFile(path.join(process.cwd(), "docs", "filmes-de-feature.md"), "utf8").catch(() => "");
  const texts = await loadFilmTexts(project.slug).catch(() => ({}));
  const scenes = await loadFilmScenes(project.slug).catch(() => []);
  return (
    <FilmStudio
      projectSlug={project.slug}
      accent={project.theme.accentDark}
      logo={project.theme.logo}
      playbook={playbook}
      texts={texts}
      scenes={scenes}
      githubRepo="sopa-agency/portal"
    />
  );
}
