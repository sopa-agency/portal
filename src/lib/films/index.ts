// Registro dos filmes por projeto. Módulo sem "server-only" de propósito: o
// estúdio (client) importa daqui, porque funções de desenho não atravessam a
// fronteira servidor → cliente como props.

import { gnarsFilms } from "./gnars";
import type { FilmSet } from "./types";

const SETS: Record<string, FilmSet> = {
  gnars: gnarsFilms,
};

export function filmsForProject(slug: string): FilmSet | null {
  return SETS[slug] ?? null;
}
