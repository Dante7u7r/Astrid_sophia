#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const expected = packageJson.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expected)) {
  throw new Error(`La version npm '${expected}' no es SemVer valida.`);
}

const manifests = new Map([
  ["package-lock.json", packageLock.version],
  ["package-lock.json packages['']", packageLock.packages?.[""]?.version],
  ["src-tauri/Cargo.toml", cargoVersion],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
]);

const mismatches = [...manifests].filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  const details = mismatches
    .map(([manifest, version]) => `${manifest}: ${String(version)}`)
    .join("; ");
  throw new Error(`Version inconsistente; package.json define ${expected}. ${details}`);
}

process.stdout.write(`Version de aplicacion consistente: ${expected}\n`);
