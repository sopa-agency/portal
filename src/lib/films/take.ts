// Helpers para escrever uma coreografia como função pura do tempo: easings,
// digitação, cursor por keyframes e estágios. Padrão do swapTake.ts do
// swaps.pro: `takeAt(t)` devolve tudo que a cena precisa para desenhar t.

export const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const out = (v: number) => 1 - (1 - clamp(v)) ** 3;
export const smooth = (v: number) => {
  const p = clamp(v);
  return p * p * (3 - 2 * p);
};
export const spring = (v: number) => 1 - Math.exp(-7 * clamp(v)) * Math.cos(9 * clamp(v));

/** Progresso 0..1 de algo que começa em `from` e dura `duration` segundos. */
export const at = (t: number, from: number, duration = 0.5) => smooth((t - from) / duration);

/** O trecho de `value` já digitado entre `from` e `to`. */
export const typed = (value: string, t: number, from: number, to: number) =>
  value.slice(0, Math.floor(value.length * clamp((t - from) / (to - from))));

/** Caret piscando enquanto digita. */
export const caretOn = (t: number) => Math.sin(t * 12) > -0.3;

export type PointerKey = { at: number; x: number; y: number };

/** Posição do cursor em t, interpolando keyframes com ease. */
export function pointerAt(t: number, keys: readonly PointerKey[]) {
  let pointer = { x: keys[0].x, y: keys[0].y };
  for (let i = 1; i < keys.length; i++) {
    const before = keys[i - 1];
    const after = keys[i];
    const p = smooth((t - before.at) / Math.max(0.01, after.at - before.at));
    pointer = { x: before.x + (after.x - before.x) * p, y: before.y + (after.y - before.y) * p };
    if (t <= after.at) break;
  }
  return pointer;
}

/** 0..1 do pulso do último clique (1 = nenhum clique em andamento). */
export function clickAt(t: number, clicks: readonly number[]) {
  const last = clicks.filter((c) => c <= t).at(-1);
  return last === undefined ? 1 : clamp((t - last) / 0.48);
}

export type CursorState = { x: number; y: number; opacity: number; click: number };

export function cursorAt(t: number, keys: readonly PointerKey[], clicks: readonly number[], show = 0.4, hide = Infinity): CursorState {
  const p = pointerAt(t, keys);
  return { ...p, opacity: smooth((t - show) / 0.3) * (1 - smooth((t - hide) / 0.35)), click: clickAt(t, clicks) };
}

/** Estágio por faixas de tempo: `stage(t, [[1.9, "a"], [3.5, "b"]], "c")`. */
export function stage<S extends string | number>(t: number, bounds: readonly (readonly [number, S])[], last: S): S {
  for (const [until, s] of bounds) if (t < until) return s;
  return last;
}

/** Contagem de 0 até `to` com ease, começando em `from` segundos. */
export const countUp = (t: number, from: number, to: number, duration = 1.2) => Math.round(to * out((t - from) / duration));
