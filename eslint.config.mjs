import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // e2e build output (NEXT_DIST_DIR in the Playwright configs).
    ".next-e2e/**",
    ".next-e2e-offline/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma-generated client.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
