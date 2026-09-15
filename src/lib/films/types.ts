// Filmes de feature: o roteiro de um filme curto (8–16 s) sobre uma página do
// produto, exportado em MP4 no navegador. Adaptado do estúdio do swaps.pro
// (coinmastersguild/swapspro @ 38c1644, src/app/demo/features) — sync manual.
// A regra que segura tudo: a cena é uma função pura do tempo. Nada depende
// do frame anterior, então o scrubber anda para trás e a exportação é só
// "desenha t, avança t".

import type { Painter } from "./draw";

export type FilmFormat = "landscape" | "portrait" | "vertical";

export const FORMATS: Record<FilmFormat, { label: string; width: number; height: number }> = {
  landscape: { label: "16:9 · X", width: 1280, height: 720 },
  portrait: { label: "4:5 · Feed", width: 1080, height: 1350 },
  vertical: { label: "9:16 · Vertical", width: 1080, height: 1920 },
};

/**
 * De onde vem uma imagem. `public:` é um caminho em /public; `drive:` é um
 * caminho dentro da pasta "🎬 Filmes" do Drive do projeto, servido pelo proxy
 * same-origin (/api/brain/drive/file?mode=raw) para o canvas não ficar "tainted".
 */
export type AssetSource = `public:${string}` | `drive:${string}` | `data:${string}`;

export type FilmAssets = Record<string, HTMLImageElement | undefined>;

export type FilmBrand = {
  name: string;
  /** Domínio mostrado na assinatura e no rodapé: "gnars.com". */
  site: string;
  /** Cor de destaque em hex de 6 dígitos (vem do tema do projeto). */
  accent: string;
  logo: AssetSource;
};

export type FeatureFilm = {
  id: string;
  label: string;
  /** Página que o filme mostra, sem protocolo: "gnars.com/auctions". */
  url: string;
  /** Documento da campanha que é a legenda ("Tweet 1"); só informativo por enquanto. */
  tweetDoc?: string;
  seconds: number;
  headline: [string, string];
  subtitle: string;
  /** Três legendas curtas (acessibilidade e a linha de rodapé), uma por terço. */
  steps: [string, string, string];
  /** A legenda do post, com as quebras de linha. */
  tweet: string;
  /** O filme mostra valores de exemplo: a legenda precisa dizer isso. */
  exampleValues?: boolean;
  /** Imagens além do logo da marca (id → fonte). */
  assets?: Record<string, AssetSource>;
  /**
   * Desenha a ação centrada em (0,0), numa caixa de ~560×520 (escala do 16:9).
   * `t` é o tempo local da cena em segundos.
   */
  draw: (p: Painter, t: number, assets: FilmAssets) => void;
  /** Legenda no tempo t; por padrão, `steps` por terços. */
  captionAt?: (t: number) => string;
};

export type FilmSet = {
  brand: Omit<FilmBrand, "accent" | "logo"> & Partial<Pick<FilmBrand, "accent" | "logo">>;
  films: FeatureFilm[];
};

export const totalSeconds = (films: readonly FeatureFilm[]) => films.reduce((n, f) => n + f.seconds, 0);

export function captionOf(film: FeatureFilm, local: number): string {
  if (film.captionAt) return film.captionAt(local);
  return film.steps[Math.min(2, Math.floor((local / film.seconds) * 3))];
}

export function sceneAt(seconds: number, films: readonly FeatureFilm[]) {
  let start = 0;
  for (let i = 0; i < films.length; i++) {
    const film = films[i];
    if (seconds < start + film.seconds || i === films.length - 1) {
      return { film, index: i, local: Math.max(0, Math.min(film.seconds, seconds - start)) };
    }
    start += film.seconds;
  }
  throw new Error("A video needs at least one scene");
}

export function supportedVideoType(recorder: Pick<typeof MediaRecorder, "isTypeSupported">): string | undefined {
  return ["video/mp4;codecs=avc1.42001E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) =>
    recorder.isTypeSupported(type),
  );
}
