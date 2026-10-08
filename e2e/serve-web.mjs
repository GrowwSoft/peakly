// Starts the web app for end-to-end tests: fresh data folder, Apple traffic sent to the mock server.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const dataDir = process.env.GI_DATA_DIR;
if (!dataDir || !dataDir.includes("e2e")) throw new Error("GI_DATA_DIR must point at a dedicated e2e folder.");
rmSync(dataDir, { recursive: true, force: true });

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", process.env.E2E_WEB_PORT ?? "3310", "--hostname", "127.0.0.1"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "development" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
