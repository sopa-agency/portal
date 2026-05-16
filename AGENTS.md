<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:theming-rules -->
# Light + dark mode is mandatory

portal-skatehive supports **both** light and dark themes. Every UI component you write or modify must render correctly in both. The theme is class-based (`<html class="dark">` for dark; absent for light) and managed by `src/components/theme-provider.tsx`.

## What this means in practice

- **Never hardcode `bg-zinc-*`, `text-zinc-*`, `bg-black`, `text-white`, `border-white/*` etc.** Use the semantic tokens defined in `src/app/globals.css` and exposed as Tailwind utilities:

  | Use case                       | Token utility                                  |
  |--------------------------------|------------------------------------------------|
  | Page background                | `bg-background`                                |
  | Card / panel surface           | `bg-surface`                                   |
  | Elevated surface (inputs, etc) | `bg-surface-elevated`                          |
  | Primary text                   | `text-foreground`                              |
  | Secondary text                 | `text-foreground-muted`                        |
  | Tertiary / metadata            | `text-foreground-subtle`                       |
  | Faint / placeholder            | `text-foreground-faint`                        |
  | Default border                 | `border-border`                                |
  | Hover/active border            | `border-border-strong`                         |
  | Brand accent (lime)            | `text-accent` / `bg-accent` / `border-accent-border` / `bg-accent-bg` |
  | Danger / error                 | `text-danger`                                  |
  | Warning                        | `text-warning`                                 |
  | Success                        | `text-success`                                 |

- **Brand / semantic colors** that exist independent of theme (X = white-on-black, Hive = red, Farcaster = purple, amber for "in progress" states, emerald for "completed") **can stay hardcoded** — but pick shades that read against BOTH backgrounds. When in doubt, use `*/80` opacity so the color works on either surface.

- **`bg-black` is reserved for full-screen overlays** (modal backdrops, etc.) — never use it for component surfaces.

- **Test both themes before claiming a UI task done.** Toggle via the sidebar's sun/moon button. If you only test one, you ship a half-broken UI.

- New CSS color values: add them as a `--name` variable in `:root` AND `.dark` in `src/app/globals.css`, then expose via `@theme inline`. Don't add Tailwind class lists like `dark:bg-X bg-Y` — the token approach scales better.
<!-- END:theming-rules -->
