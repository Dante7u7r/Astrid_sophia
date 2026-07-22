import { resolve } from "node:path";

export const config = {
  runner: "local",
  specs: ["./tests/e2e/desktop/**/*.spec.mjs"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", {
    appBinaryPath: resolve("src-tauri/target/release/astryd-sophia.exe"),
    driverProvider: "embedded",
    embeddedPort: 4445,
    startTimeout: 90_000,
    statusPollTimeout: 5_000,
    captureFrontendLogs: true,
    captureBackendLogs: true,
  }]],
  capabilities: [{
    browserName: "tauri",
    "tauri:options": {
      application: resolve("src-tauri/target/release/astryd-sophia.exe"),
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
};
