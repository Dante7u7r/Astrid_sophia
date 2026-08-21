#!/usr/bin/env node

/**
 * Script de inspección en vivo de Astryd Sophia.
 * Lee el estado actual exportado por la aplicación en `.astryd_live/state.json`
 * y presenta un resumen completo de componentes, voltajes, cables y errores de ERC.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const LIVE_DIR = resolve(process.cwd(), ".astryd_live");
const STATE_FILE = join(LIVE_DIR, "state.json");
const SVG_FILE = join(LIVE_DIR, "schematic.svg");

function formatLiveSummary() {
  if (!existsSync(STATE_FILE)) {
    console.log("No se encontró un estado en vivo de Astryd Sophia en `.astryd_live/state.json`.");
    console.log("Asegúrate de que la aplicación esté abierta en el simulador.");
    process.exit(0);
  }

  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    const state = JSON.parse(raw);

    console.log("==================================================================");
    console.log(`📡 ASTRYD SOPHIA — ESTADO EN VIVO (${state.timestamp})`);
    console.log("==================================================================");
    console.log(`Pestaña activa:     ${state.activeTab?.name ?? "N/A"} [${state.activeTab?.analysisMode ?? "N/A"}]`);
    console.log(`Modificaciones:     ${state.activeTab?.unsaved ? "Con cambios sin guardar" : "Guardado"}`);
    console.log(`Estado simulación:  ${state.metrics?.isSimulating ? "⚡ ACTIVA (En ejecución)" : "⏸ Detenida / Reposo"}`);
    console.log(`Componentes:        ${state.metrics?.componentCount ?? 0}`);
    console.log(`Cables:             ${state.metrics?.wireCount ?? 0}`);
    console.log(`Nodos resueltos:    ${state.metrics?.resolvedNodeCount ?? 0}`);
    console.log("------------------------------------------------------------------");

    if (Array.isArray(state.components) && state.components.length > 0) {
      console.log("\n📦 COMPONENTES EN EL LIENZO:");
      for (const comp of state.components) {
        const valueStr = comp.value !== undefined ? `(${comp.value})` : "";
        const labelStr = comp.label ? `[${comp.label}]` : "";
        const terminalStr = comp.terminalType ? `{Terminal: ${comp.terminalType}}` : "";
        const voltStr = comp.voltage !== undefined ? `[${comp.voltage}V]` : "";
        const waveStr = comp.waveType ? `[Onda: ${comp.waveType}, ${comp.frequency ?? 1000}Hz]` : "";
        console.log(`  - ${comp.id.padEnd(8)} ${comp.type.padEnd(16)} en (${comp.x}, ${comp.y}) ${valueStr} ${labelStr} ${terminalStr} ${voltStr} ${waveStr}`);
      }
    } else {
      console.log("\n(No hay componentes en el lienzo)");
    }

    if (state.nodeVoltages && Object.keys(state.nodeVoltages).length > 0) {
      console.log("\n⚡ LECTURAS DE VOLTAJE ACTUALES:");
      for (const [node, volt] of Object.entries(state.nodeVoltages)) {
        const vFormatted = typeof volt === "number" ? volt.toFixed(4) + " V" : String(volt);
        console.log(`  Nodo ${node.padEnd(6)}: ${vFormatted}`);
      }
    }

    if (Array.isArray(state.ercIssues) && state.ercIssues.length > 0) {
      console.log("\n⚠️ ADVERTENCIAS / ERRORES DE ERC:");
      for (const issue of state.ercIssues) {
        console.log(`  [${issue.severity.toUpperCase()}] ${issue.message}`);
      }
    }

    if (existsSync(SVG_FILE)) {
      console.log(`\n🖼️ Esquema vectorial SVG disponible en: ${SVG_FILE}`);
    }

    console.log("==================================================================\n");
  } catch (err) {
    console.error("Error al leer el estado en vivo:", err.message);
  }
}

formatLiveSummary();
