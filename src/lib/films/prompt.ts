// Prompts que pedem à IA do portal uma cena em dados (FilmSpec): gerar do
// zero a partir de uma página/tweet, ou remixar uma cena existente com uma
// instrução. Sem "server-only" para o teste a seco poder importar.

import { EXAMPLE_SPEC, SPEC_GUIDE, type FilmSpec } from "./spec";
import type { FeatureFilm, FilmSet } from "./types";

export type SceneBrief = {
  /** Nome curto da feature: "Auctions". */
  label: string;
  /** Página mostrada: "gnars.com/auctions". */
  url: string;
  /** O tweet ou um resumo do que a página faz. */
  about: string;
  /** Direção livre: tom, o que destacar, o que evitar. */
  instruction?: string;
  seconds?: number;
};

/** Os assets que a IA pode usar: tudo que os roteiros do projeto já declaram. */
export function assetCatalog(set: FilmSet, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { ...(set.extraAssets ?? {}), ...extra };
  for (const f of set.films) for (const [k, v] of Object.entries(f.assets ?? {})) if (v.startsWith("public:")) out[`${f.id}-${k}`] = v;
  return out;
}

function catalogText(catalog: Record<string, string>) {
  const lines = Object.entries(catalog).map(([id, src]) => `- ${id}: ${src.replace(/^public:/, "")}${src.endsWith(".glb") ? " (3D model: use with a scene3d layer)" : ""}`);
  return lines.length ? lines.join("\n") : "- (no assets; draw with shapes and text only)";
}

function persona(set: FilmSet) {
  return `You are the motion designer of ${set.brand.name} (${set.brand.site}), writing short product films for X: one page, one scripted interaction, no hype.`;
}

export function generatePrompt(set: FilmSet, brief: SceneBrief, catalog: Record<string, string>): string {
  return `${persona(set)}

Write ONE scene as JSON for the feature "${brief.label}" (page ${brief.url}).
What the page does / the post it pairs with:
${brief.about}
${brief.instruction ? `\nDirection: ${brief.instruction}\n` : ""}
${SPEC_GUIDE}

Assets you may reference (asset id: file). Reference them by the id on the left inside "assets" as {"<yourId>": "public:<file>"}:
${catalogText(catalog)}

Here is a complete valid scene for reference (different feature; do not copy its content, copy its shape):
${JSON.stringify(EXAMPLE_SPEC)}

Rules: seconds ${brief.seconds ?? "10-14"}. id is a new slug for this scene. headline line 2 carries the punch. tweet under 260 characters, plain, with the page URL, and it must say "example amounts" if any number is on screen. Return ONLY the JSON object. No prose, no code fences.`;
}

export type RemixSource =
  | { kind: "data"; spec: FilmSpec }
  | { kind: "code"; film: FeatureFilm };

export function remixPrompt(set: FilmSet, source: RemixSource, instruction: string, catalog: Record<string, string>): string {
  const original =
    source.kind === "data"
      ? `Here is the current scene as JSON:\n${JSON.stringify(source.spec)}`
      : `The current scene is drawn in code, so here is what it shows, plus its texts:
- label: ${source.film.label}; page: ${source.film.url}; seconds: ${source.film.seconds}
- headline: ${JSON.stringify(source.film.headline)}; subtitle: ${JSON.stringify(source.film.subtitle)}
- captions: ${JSON.stringify(source.film.captions ?? source.film.steps)}
- tweet: ${JSON.stringify(source.film.tweet)}
- what the action shows: ${source.film.describe ?? "(no description)"}
- its assets: ${JSON.stringify(source.film.assets ?? {})}
Rebuild it as a JSON scene with the same story, then apply the direction.`;
  return `${persona(set)}

${original}

Direction for the remix: ${instruction}

${SPEC_GUIDE}

Assets you may reference (asset id: file). Reference them inside "assets" as {"<yourId>": "public:<file>"}:
${catalogText(catalog)}

Reference shape of a valid scene:
${JSON.stringify(EXAMPLE_SPEC)}

Rules: keep what the direction does not ask to change. New id (slug) for the remix. tweet under 260 characters with the page URL; say "example amounts" if any number is on screen. Return ONLY the JSON object. No prose, no code fences.`;
}
