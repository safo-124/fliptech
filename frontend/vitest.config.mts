import {configDefaults, defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    // Playwright owns browser E2E specs. Importing them into Vitest makes the
    // two test runners fight over their incompatible global lifecycle APIs.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
