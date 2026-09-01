import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// @snapduka/core is pure, platform-agnostic logic shared by the web app and the
// Expo app: no React, no DOM, no react-native. Lint accordingly — the value here
// is catching dead code and accidental `any` in rules both apps depend on.
export default defineConfig([
  globalIgnores(["**/node_modules/**", "**/dist/**", "**/coverage/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": "error",
    },
  },
]);
