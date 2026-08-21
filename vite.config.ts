import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

function liveStatePlugin(): Plugin {
  return {
    name: "astryd-live-state-plugin",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/__astryd_live_state__" && req.method === "POST") {
          let body = "";
          req.on("data", chunk => { body += chunk; });
          req.on("end", () => {
            try {
              const data = JSON.parse(body);
              const liveDir = path.resolve(process.cwd(), ".astryd_live");
              if (!fs.existsSync(liveDir)) {
                fs.mkdirSync(liveDir, { recursive: true });
              }
              if (data.stateJson) {
                fs.writeFileSync(path.join(liveDir, "state.json"), data.stateJson, "utf8");
              }
              if (data.svgSchematic) {
                fs.writeFileSync(path.join(liveDir, "schematic.svg"), data.svgSchematic, "utf8");
              }
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            }
          });
          return;
        }
        next();
      });
    },
  };
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [liveStatePlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and `.astryd_live`
      ignored: ["**/src-tauri/**", "**/.astryd_live/**"],
    },
  },

  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("jspdf")) {
              return "vendor-jspdf";
            }
            if (id.includes("html2canvas")) {
              return "vendor-html2canvas";
            }
            if (id.includes("dompurify")) {
              return "vendor-dompurify";
            }
            if (id.includes("@tauri-apps")) {
              return "vendor-tauri";
            }
          }
          if (id.includes("commercial_models_catalog") || id.includes("component_chip_catalog")) {
            return "catalog-models";
          }
          if (id.includes("mcu-8051") || id.includes("mcu-avr")) {
            return "mcu-emulators";
          }
          if (id.includes("src/components/") || id.includes("src\\components\\")) {
            return "circuit-components";
          }
        },
      },
    },
  },

  // Vitest — pruebas unitarias de módulos puros (sin DOM, sin Tauri) y tests de integración
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        statements: 40,
        branches: 35,
        functions: 45,
        lines: 40,
      },
    },
  },
}));
