import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build artifacts que não devem ser lintados:
    "dist/**",
    "node_modules/**",
    // Serviço separado (GPL-3.0), com pacote e testes próprios:
    "services/**",
  ]),
]);

export default eslintConfig;
