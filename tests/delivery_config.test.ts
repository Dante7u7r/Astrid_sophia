import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8")) as T;
}

interface TauriIsolationConfig {
  identifier?: string;
  app: {
    withGlobalTauri: boolean;
    windows?: Array<{ dataDirectory?: string }>;
    security: {
      capabilities: Array<string | { identifier: string; permissions: string[] }>;
    };
  };
}

describe("configuracion de entrega escritorio", () => {
  it("empaqueta Windows y conserva limites minimos de ventana", () => {
    const config = readJson<{
      identifier: string;
      productName: string;
      app: { windows: Array<{ minWidth: number; minHeight: number; title: string }> };
      bundle: { active: boolean; targets: string[] };
    }>("src-tauri/tauri.conf.json");

    expect(config.identifier).toBe("com.biaani.desktop");
    expect(config.productName).toBe("Biaani");
    expect(config.bundle.active).toBe(true);
    expect(config.bundle.targets).toContain("nsis");
    expect(config.bundle.targets).not.toContain("deb");
    expect(config.bundle.targets).not.toContain("rpm");
    expect(config.app.windows[0]).toMatchObject({
      title: "Biaani",
      minWidth: 900,
      minHeight: 600,
    });
  });

  it("separa el perfil y los datos E2E del identificador de produccion", () => {
    const production = readJson<TauriIsolationConfig>("src-tauri/tauri.conf.json");
    const e2e = readJson<TauriIsolationConfig>("src-tauri/tauri.wdio.conf.json");

    expect(production.identifier).toBe("com.biaani.desktop");
    expect(e2e.identifier).toBe("com.biaani.desktop.wdio");
    expect(e2e.identifier).not.toBe(production.identifier);

    // Tauri 2 deriva el perfil WebView2 de LocalData/identifier y app_data_dir()
    // de Data/identifier. lib.rs abre feedback dentro de este ultimo directorio.
    // Sin dataDirectory explicito, el overlay separa ambos almacenes por identidad.
    for (const window of [...(production.app.windows ?? []), ...(e2e.app.windows ?? [])]) {
      expect(window.dataDirectory).toBeUndefined();
    }
  });

  it("mantiene la instrumentacion WDIO fuera de la configuracion de produccion", () => {
    const production = readJson<TauriIsolationConfig>("src-tauri/tauri.conf.json");
    const e2e = readJson<TauriIsolationConfig>("src-tauri/tauri.wdio.conf.json");
    const defaultCapability = readJson<{ permissions: string[] }>("src-tauri/capabilities/default.json");

    expect(production.app.withGlobalTauri).toBe(false);
    expect(production.app.security.capabilities).toEqual(["default"]);
    expect(defaultCapability.permissions.some(permission => permission.startsWith("wdio:"))).toBe(false);
    expect(e2e.app.withGlobalTauri).toBe(true);
    expect(e2e.app.security.capabilities).toContainEqual(expect.objectContaining({
      identifier: "wdio",
      permissions: ["wdio:default"],
    }));
  });

  it("compila los E2E nativos con el overlay aislado y la feature WDIO explicita", () => {
    const packageJson = readJson<{ scripts: Record<string, string> }>("package.json");
    const buildE2e = packageJson.scripts["test:e2e:desktop:build"];

    expect(buildE2e).toContain("--features wdio");
    expect(buildE2e).toContain("--config src-tauri/tauri.wdio.conf.json");
  });

  it("no deja metadatos placeholder en npm ni Cargo", () => {
    const packageJson = readJson<{ name: string; description: string; author: string }>("package.json");
    const cargoToml = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");

    expect(packageJson.name).toBe("biaani");
    expect(packageJson.description).toContain("simulador");
    expect(packageJson.author).not.toBe("you");
    expect(cargoToml).toContain('description = "Simulador de circuitos electronicos de escritorio"');
    expect(cargoToml).toContain('authors = ["Biaani Project"]');
  });

  it("mantiene una unica version de aplicacion en todos los manifiestos", () => {
    const packageJson = readJson<{ version: string }>("package.json");
    const packageLock = readJson<{
      version: string;
      packages: Record<string, { version?: string }>;
    }>("package-lock.json");
    const tauriConfig = readJson<{ version: string }>("src-tauri/tauri.conf.json");
    const cargoToml = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
    const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[""]?.version).toBe(packageJson.version);
    expect(tauriConfig.version).toBe(packageJson.version);
    expect(cargoVersion).toBe(packageJson.version);
  });
});
