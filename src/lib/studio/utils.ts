// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
