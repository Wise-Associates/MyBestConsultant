import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Le module assistant est portable (src/assistant/README.md) : il n'importe rien de l'application, qui lui fournit
// ses adaptateurs (AssistantHost). Le cœur ne dépend ni de React ni de Next.js, la fenêtre de chat pas de Next.js.
const ASSISTANT_BOUNDARY = {
  group: ["@/*", "../../*"],
  message: "src/assistant est un module portable : passez par AssistantHost (src/assistant/core/types.ts) plutôt que d'importer l'application.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/assistant/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [ASSISTANT_BOUNDARY, { group: ["react", "react-dom", "next", "next/*"], message: "Le cœur de l'assistant ne dépend d'aucun framework." }] }],
    },
  },
  {
    files: ["src/assistant/react/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [ASSISTANT_BOUNDARY, { group: ["next", "next/*"], message: "La fenêtre de chat doit marcher sur tout site React, pas seulement Next.js." }] }],
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
