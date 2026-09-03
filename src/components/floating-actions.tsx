import { PageInfo } from "@/components/page-info";
import { getActiveProject } from "@/projects/index";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The app-chrome controls pinned to the top-right corner.
 *
 * They live in one flex row rather than each pinning itself with its own
 * `right-*` offset: the page guide only exists for some routes, so hardcoded
 * offsets leave a hole in the row wherever there is no guide, and every new
 * button means re-numbering the ones beside it.
 *
 * Anything added here also has to clear the compact PageHeader's actions, which
 * reserve room for this row on the right.
 */
export async function FloatingActions() {
  // Um botão de idioma num portal de idioma travado não muda nada — e botão
  // que não faz nada é pior que botão nenhum.
  const project = await getActiveProject();
  return (
    <div className="fixed right-4 top-4 z-40 flex items-center gap-1.5">
      <PageInfo />
      {!project.forcedLocale && <LanguageToggle />}
      <ThemeToggle />
    </div>
  );
}
