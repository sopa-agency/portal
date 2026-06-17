import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
