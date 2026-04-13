import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Accessibility rules (jsx-a11y plugin is already loaded by eslint-config-next)
  {
    rules: {
      // Allow autoFocus on inputs (trading terminal UX)
      "jsx-a11y/no-autofocus": "off",
      // img alt as warning
      "jsx-a11y/alt-text": "warn",
    },
  },
  // Prettier compat — must be last to disable conflicting format rules
  prettier,
  // Ignores
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
