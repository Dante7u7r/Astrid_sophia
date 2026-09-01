import { resolve } from "node:path";
import { browser } from "@wdio/globals";
import type {} from "@wdio/tauri-service";
import { cleanupWindowsWebDrivers } from "./scripts/windows_driver_cleanup";

const appBinaryPath = process.env.ASTRYD_E2E_BINARY_PATH
  ? resolve(process.env.ASTRYD_E2E_BINARY_PATH)
  : resolve("src-tauri/target/debug/biaani.exe");

export const config = {
  runner: "local",
  specs: ["./tests/e2e/desktop/**/*.spec.mjs"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath,
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
      application: appBinaryPath,
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
  beforeSuite: async () => {
    const identifier = await browser.tauri.execute(tauri => tauri.core.invoke("plugin:app|identifier"));
    if (identifier !== "com.biaani.desktop.wdio") {
      throw new Error("E2E bloqueado: el ejecutable no utiliza el perfil aislado de pruebas.");
    }
  },
  onComplete: () => cleanupWindowsWebDrivers(),
};
