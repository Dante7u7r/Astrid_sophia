import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8")) as T;
}

describe("configuracion de entrega escritorio", () => {
  it("empaqueta Windows y conserva limites minimos de ventana", () => {
    const config = readJson<{
      identifier: string;
      productName: string;
      app: { windows: Array<{ minWidth: number; minHeight: number; title: string }> };
      bundle: { active: boolean; targets: string[] };
    }>("src-tauri/tauri.conf.json");

    expect(config.identifier).toBe("com.astrydsophia.desktop");
    expect(config.productName).toBe("Astryd Sophia");
    expect(config.bundle.active).toBe(true);
    expect(config.bundle.targets).toContain("nsis");
    expect(config.bundle.targets).not.toContain("deb");
    expect(config.bundle.targets).not.toContain("rpm");
    expect(config.app.windows[0]).toMatchObject({
      title: "Astryd Sophia",
      minWidth: 900,
      minHeight: 600,
    });
  });

  it("no deja metadatos placeholder en npm ni Cargo", () => {
    const packageJson = readJson<{ name: string; description: string; author: string }>("package.json");
    const cargoToml = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");

    expect(packageJson.name).toBe("astryd-sophia");
    expect(packageJson.description).toContain("simulador");
    expect(packageJson.author).not.toBe("you");
    expect(cargoToml).toContain('description = "Simulador de circuitos electronicos de escritorio"');
    expect(cargoToml).toContain('authors = ["Astryd Sophia Project"]');
  });
});
