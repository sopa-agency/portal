import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The core-web-vitals/typescript subpaths of eslint-config-next don't register
  // the react-hooks plugin (only the root "eslint-config-next" config does), yet
  // the rule overrides below reference react-hooks/*. Register the plugin and its
  // recommended rules here so those references resolve — mirrors the root config.
  {
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  // The React-Compiler lint rules flag legitimate, intentional patterns here:
  // the localStorage "load on mount" idiom sets state in an effect across the
  // app, so downgrade that one rule to a warning rather than a hard error.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Vendored studio editors (reelflip-studio / canvas video editor) use refs
  // during render + mutate working objects by design. Turn the React-Compiler
  // rules off for them so their authored patterns aren't flagged as errors.
  {
    files: ["src/components/studio/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
    },
  },
  // Non-component lib code: a plain predicate named useBrainQueue() trips the
  // hooks rule, but these files aren't React components.
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // Node worker scripts and CommonJS modules legitimately use require() — they
  // run under Node, not the bundler, so the no-require-imports rule doesn't apply.
  {
    files: ["scripts/**/*.{js,cjs}", "src/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // In-repo git worktrees are separate checkouts (with their own .next build
    // output) — linting them from the main repo doubles every finding and floods
    // the report with generated-code noise.
    ".worktrees/**",
    "**/.next/**",
  ]),
]);

export default eslintConfig;
