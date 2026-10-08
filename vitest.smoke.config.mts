import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Live, read-only checks against App Store Connect. Run manually: GI_SMOKE_ASC_CONFIG=<json> npm run smoke */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["test/**/*.smoke.ts"], testTimeout: 600_000 },
});
