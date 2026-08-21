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
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, "/");

          // 1. Dependencias externas (Vendor)
          if (norm.includes("node_modules")) {
            if (norm.includes("jspdf")) return "vendor-jspdf";
            if (norm.includes("html2canvas")) return "vendor-html2canvas";
            if (norm.includes("dompurify")) return "vendor-dompurify";
            if (norm.includes("@tauri-apps")) return "vendor-tauri";
            return "vendor-misc";
          }

          // 2. Componentes EDA, Renderizadores de Símbolos y Catálogos de Modelos
          if (
            norm.includes("src/components/") ||
            norm.includes("src/canvas/component_annotation") ||
            norm.includes("src/canvas/component_compact") ||
            norm.includes("src/canvas/component_renderer")
          ) {
            return "circuit-components";
          }
          if (norm.includes("commercial_models_catalog") || norm.includes("component_chip_catalog")) {
            return "catalog-models";
          }

          // 3. Emuladores de Microcontroladores
          if (norm.includes("mcu-8051") || norm.includes("mcu-avr") || norm.includes("mcu-runtime") || norm.includes("mcu_peripheral_models")) {
            return "mcu-emulators";
          }

          // 4. Instrumentos y Paneles UI Especializados
          if (norm.includes("src/ui/oscilloscope") || norm.includes("src/ui/eye_diagram")) {
            return "ui-oscilloscope";
          }
          if (norm.includes("src/ui/bode_plot") || norm.includes("src/ui/pole_zero")) {
            return "ui-bode-analysis";
          }
          if (norm.includes("src/ui/fft_analyzer")) {
            return "ui-fft-analyzer";
          }
          if (norm.includes("src/ui/logic_analyzer")) {
            return "ui-logic-analyzer";
          }
          if (norm.includes("src/ui/curve_tracer")) {
            return "ui-curve-tracer";
          }
          if (norm.includes("src/ui/parametric_sweep") || norm.includes("src/ui/sensitivity_plot") || norm.includes("src/ui/corner_analysis")) {
            return "ui-sweeps-analysis";
          }
          if (norm.includes("src/ui/cad_schematic_exporter") || norm.includes("src/ui/exporter_model") || norm.includes("src/ui/pdf_export") || norm.includes("src/ui/svg_sanitizer")) {
            return "ui-cad-exporter";
          }
          if (norm.includes("src/ui/signal_generator")) {
            return "ui-signal-generator";
          }
          if (norm.includes("src/ui/mcu_debug") || norm.includes("src/ui/mcu_firmware")) {
            return "ui-mcu-debug";
          }

          // 5. Módulos de Física Avanzada y Solvers
          if (norm.includes("src/simulation/fallback_mna") || norm.includes("src/simulation/fallback_solver")) {
            return "sim-fallback-solvers";
          }
          if (norm.includes("src/simulation/cloud_simulation_client")) {
            return "sim-cloud-client";
          }
          if (norm.includes("src/simulation/aging_models") || norm.includes("src/simulation/electromigration_models") || norm.includes("src/simulation/radiation_models")) {
            return "sim-reliability-physics";
          }
          if (norm.includes("src/simulation/thermal_network_model") || norm.includes("src/simulation/wbg_power_models")) {
            return "sim-thermal-power";
          }
          if (norm.includes("src/simulation/automated_measurements") || norm.includes("src/simulation/touchstone")) {
            return "sim-measurements";
          }

          // 6. Motores de Canvas, Enrutado, DRC y Efectos Visuales
          if (
            norm.includes("src/canvas/drc_engine") ||
            norm.includes("src/canvas/multi_net_router") ||
            norm.includes("src/canvas/smart_wire_router") ||
            norm.includes("src/canvas/bus_wiring") ||
            norm.includes("src/canvas/wire_cleanup") ||
            norm.includes("src/canvas/thermal_heatmap") ||
            norm.includes("src/canvas/current_animation")
          ) {
            return "canvas-tools";
          }

          // 7. Language Server y Plugins
          if (norm.includes("src/lsp/")) {
            return "feature-lsp";
          }
          if (norm.includes("src/plugins/")) {
            return "feature-plugins";
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
        statements: 55,
        branches: 42,
        functions: 50,
        lines: 55,
      },
    },
  },
}));
