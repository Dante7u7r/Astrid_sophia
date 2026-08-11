import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function cleanupWindowsWebDrivers(): void {
  if (process.platform !== "win32") return;
  for (const imageName of ["tauri-driver.exe", "msedgedriver.exe"]) {
    try {
      execFileSync("taskkill.exe", ["/F", "/T", "/IM", imageName], { stdio: "ignore" });
    } catch {
      // taskkill returns a non-zero exit code when there is nothing to stop.
    }
  }
}

export const config = {
  runner: "local",
  specs: ["./tests/e2e/desktop/**/*.spec.mjs"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath: resolve("src-tauri/target/debug/astryd-sophia.exe"),
    driverProvider: "external",
    autoInstallTauriDriver: true,
    autoDownloadEdgeDriver: true,
    tauriDriverPort: 4444,
    startTimeout: 90_000,
    captureFrontendLogs: true,
    captureBackendLogs: true,
  }]],
  capabilities: [{
    browserName: "tauri",
    "tauri:options": {
      application: resolve("src-tauri/target/debug/astryd-sophia.exe"),
    },
  }],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },
  onComplete: cleanupWindowsWebDrivers,
};
