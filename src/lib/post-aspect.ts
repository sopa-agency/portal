// Shared post aspect-ratio types + helpers. Extracted from post-creator so the
// Lab and any other composer reuse the exact same logic the Post Creator uses.

export type AspectRatio = "1:1" | "4:5" | "1.91:1" | "9:16";

export type UploadState = { url: string; previewUrl: string; isVideo: boolean; aspect?: number };

export function aspectToClass(ratio: AspectRatio): string {
  switch (ratio) {
    case "1:1":
      return "aspect-square";
    case "4:5":
      return "aspect-[4/5]";
    case "1.91:1":
      return "aspect-[1.91/1]";
    case "9:16":
      return "aspect-[9/16] max-h-[440px]";
  }
}

/** Snap a measured aspect number to the nearest valid IG feed ratio. */
export function snapToFeedRatio(aspect: number): AspectRatio {
  if (aspect >= 1.4) return "1.91:1";
  if (aspect <= 0.65) return "9:16"; // Reels-native vertical
  if (aspect <= 0.85) return "4:5";
  return "1:1";
}
