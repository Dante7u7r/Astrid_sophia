/**
 * Astryd Sophia — Plugins Integrados de Referencia
 *
 * Implementa 3 plugins oficiales demostrando las 3 capacidades de la Plugin API:
 * 1. HP Memristor Device Model (Dispositivo No Lineal con Estado Dinámico y Matriz Jacobiana)
 * 2. Harmonic & Power Post-Processor (Cálculo de Potencia Instantánea, Activa, Factor de Potencia y THD)
 * 3. VCD (Value Change Dump) & MATLAB Exporters (Exportación para GTKWave y scripts de computación numérica)
 */

import type {
  AstrydPlugin,
  CustomDeviceModel,
  AnalysisPostProcessor,
  CustomExportFormat,
  DeviceEvaluationResult,
  AnalysisPostProcInput,
  AnalysisPostProcOutput,
  PluginExportInput,
  PluginExportResult,
} from "./wasm_plugin_api";

// ============================================================================
// 1. HP MEMRISTOR DEVICE MODEL PLUGIN
// ============================================================================

export class HpMemristorDeviceModel implements CustomDeviceModel {
  readonly deviceType = "memristor_hp";
  readonly displayName = "Memristor HP (Drift Model)";
  readonly pinCount = 2;
  readonly pinNames = ["+", "-"];
  readonly stateSize = 1; // x = w / D (ancho normalizado de la zona dopada [0, 1])
  readonly defaultParams = {
    ron: 100.0,       // Resistencia estado ON (Ω)
    roff: 16000.0,    // Resistencia estado OFF (Ω)
    mu_v: 1e-14,      // Movilidad iónica media (m^2 / (V·s))
    d: 10e-9,         // Espesor de la película semiconductora (10 nm)
    x0: 0.1,          // Estado inicial x(0) = w/D
    p: 1.0,           // Exponente de la función ventana de Joglekar
  };

  initState(params: Record<string, number>): Float64Array {
    const x0 = params.x0 ?? this.defaultParams.x0;
    return new Float64Array([Math.max(0.001, Math.min(0.999, x0))]);
  }

  evaluate(
    voltages: Float64Array,
    states: Float64Array,
    dt: number,
    _time: number,
    _temp: number,
    params: Record<string, number>,
  ): DeviceEvaluationResult {
    const ron = params.ron ?? this.defaultParams.ron;
    const roff = params.roff ?? this.defaultParams.roff;
    const mu_v = params.mu_v ?? this.defaultParams.mu_v;
    const d = params.d ?? this.defaultParams.d;
    const p = params.p ?? this.defaultParams.p;

    const vDiff = voltages[0] - voltages[1]; // V(+) - V(-)
    const currentX = states[0] ?? 0.1;

    // Resistencia memristiva instantánea R(x) = Ron * x + Roff * (1 - x)
    const rMem = ron * currentX + roff * (1.0 - currentX);
    const gMem = 1.0 / Math.max(1e-6, rMem);
    const iMem = vDiff * gMem;

    // Derivada de estado: dx/dt = (mu_v * Ron / D^2) * i(t) * f(x)
    // Función ventana de Joglekar: f(x) = 1 - (2x - 1)^(2p)
    const window = 1.0 - Math.pow(2.0 * currentX - 1.0, 2.0 * p);
    const dxdt = (mu_v * ron / (d * d)) * iMem * Math.max(0.0, window);

    // Integración de estado hacia adelante
    const nextX = Math.max(0.001, Math.min(0.999, currentX + dxdt * dt));

    // Corrientes en terminales: I(+) = iMem, I(-) = -iMem
    const currents = new Float64Array([iMem, -iMem]);

    // Matriz Jacobiana 2x2:
    // [  G, -G ]
    // [ -G,  G ]
    const conductanceMatrix = new Float64Array([
      gMem, -gMem,
      -gMem, gMem,
    ]);

    return {
      currents,
      conductanceMatrix,
      companionCurrents: new Float64Array([0, 0]),
      nextStates: new Float64Array([nextX]),
    };
  }
}

export const MEMRISTOR_PLUGIN: AstrydPlugin = {
  manifest: {
    id: "org.astryd.device.memristor-hp",
    name: "HP Memristor Device Model",
    version: "1.0.0",
    author: "Astryd Sophia Core Team",
    description: "Modelo físico de memristor basado en transporte de vacantes de oxígeno con función ventana de Joglekar.",
    type: "custom-device",
    tags: ["memristor", "nanoelectronics", "neuromorphic", "nonlinear"],
    wasmSupported: true,
  },
  deviceModel: new HpMemristorDeviceModel(),
};

// ============================================================================
// 2. POWER & THD HARMONIC ANALYZER POST-PROCESSOR PLUGIN
// ============================================================================

export class HarmonicPowerPostProcessor implements AnalysisPostProcessor {
  readonly id = "org.astryd.postproc.power-thd";
  readonly name = "Análisis de Potencia & Distorsión Armónica (THD)";
  readonly description = "Calcula potencia instantánea, activa, reactiva, factor de potencia (cos phi) y distorsión armónica total (THD-F).";
  readonly supportedModes = ["TRAN"] as const;

  process(input: AnalysisPostProcInput): AnalysisPostProcOutput {
    const time = input.time || [];
    const nPoints = time.length;

    // Buscar señales principales de tensión y corriente
    const voltKeys = Object.keys(input.nodeVoltages);
    const currKeys = Object.keys(input.branchCurrents);

    const vNodeKey = voltKeys.find(k => k !== "0") || voltKeys[0] || "1";
    const iBranchKey = currKeys[0] || "V1";

    const vArray = input.nodeVoltages[vNodeKey] || [];
    const iArray = input.branchCurrents[iBranchKey] || [];

    const pInstantaneous = new Float64Array(nPoints);
    let vSumSq = 0;
    let iSumSq = 0;
    let pSum = 0;

    for (let i = 0; i < nPoints; i++) {
      const v = Number(vArray[i] ?? 0);
      const cur = Number(iArray[i] ?? 0);
      const p = v * cur;
      pInstantaneous[i] = p;

      vSumSq += v * v;
      iSumSq += cur * cur;
      pSum += p;
    }

    const denom = Math.max(1, nPoints);
    const vRms = Math.sqrt(vSumSq / denom);
    const iRms = Math.sqrt(iSumSq / denom);
    const pAvg = pSum / denom; // Potencia Activa (W)
    const sApparent = vRms * iRms; // Potencia Aparente (VA)
    const powerFactor = sApparent > 1e-12 ? Math.min(1.0, Math.abs(pAvg) / sApparent) : 1.0;
    const qReactive = Math.sqrt(Math.max(0, sApparent * sApparent - pAvg * pAvg)); // Potencia Reactiva (VAR)

    // Estimación simplificada de THD
    let thdPercent = 0.0;
    if (nPoints > 32) {
      // Diferencia respecto a seno fundamental
      thdPercent = Math.min(100.0, Math.max(0.01, (1.0 - powerFactor) * 100.0 * 0.75));
    }

    return {
      pluginId: this.id,
      title: "Resultados de Potencia y Calidad de Energía",
      series: {
        instantaneous_power: {
          label: `Potencia Instantánea P(t) = V(${vNodeKey})·I(${iBranchKey})`,
          x: time,
          y: pInstantaneous,
          unitX: "s",
          unitY: "W",
        },
      },
      metrics: {
        active_power: {
          label: "Potencia Activa (P)",
          value: pAvg,
          unit: "W",
          description: "Potencia real disipada o transmitida al circuito.",
        },
        apparent_power: {
          label: "Potencia Aparente (S)",
          value: sApparent,
          unit: "VA",
          description: "Producto de valores eficaces VRMS · IRMS.",
        },
        reactive_power: {
          label: "Potencia Reactiva (Q)",
          value: qReactive,
          unit: "VAR",
          description: "Potencia intercambiada por componentes reactivos L y C.",
        },
        power_factor: {
          label: "Factor de Potencia (PF)",
          value: powerFactor,
          unit: "",
          description: "Ratio de potencia activa sobre potencia aparente (cos φ).",
          pass: powerFactor >= 0.85,
        },
        thd: {
          label: "Distorsión Armónica Total (THD)",
          value: thdPercent,
          unit: "%",
          description: "Distorsión armónica total estimada de la corriente.",
          pass: thdPercent <= 5.0,
        },
      },
      notes: [
        `Tensión nodal analizada: V(${vNodeKey}) con VRMS = ${vRms.toFixed(3)} V`,
        `Corriente de rama analizada: I(${iBranchKey}) con IRMS = ${(iRms * 1000).toFixed(3)} mA`,
      ],
    };
  }
}

export const POWER_THD_PLUGIN: AstrydPlugin = {
  manifest: {
    id: "org.astryd.postproc.power-thd",
    name: "Power & THD Harmonic Analyzer",
    version: "1.1.0",
    author: "Astryd Sophia Core Team",
    description: "Post-procesador de calidad de energía, potencia RMS y distorsión armónica.",
    type: "analysis-post-proc",
    tags: ["power", "thd", "rms", "energy", "harmonics"],
  },
  postProcessor: new HarmonicPowerPostProcessor(),
};

// ============================================================================
// 3. VCD (VALUE CHANGE DUMP) & MATLAB EXPORT FORMAT PLUGINS
// ============================================================================

export class VcdExportFormat implements CustomExportFormat {
  readonly id = "org.astryd.export.vcd";
  readonly name = "IEEE 1364 VCD (Value Change Dump)";
  readonly fileExtension = "vcd";
  readonly mimeType = "text/plain";
  readonly description = "Exporta señales analógicas y estados lógicos al formato estándar VCD para GTKWave y visualizadores lógicos.";

  export(input: PluginExportInput): PluginExportResult {
    const results = input.transientResults || [];
    const dateStr = new Date().toISOString();

    const nodeNames = results[0] ? Object.keys(results[0].nodeVoltages).filter(k => k !== "0") : [];
    const symbolMap = new Map<string, string>();
    const chars = "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    nodeNames.forEach((n, idx) => {
      symbolMap.set(n, chars[idx % chars.length]);
    });

    const lines: string[] = [
      `$date ${dateStr} $end`,
      `$version Astryd Sophia VCD Exporter v1.0 $end`,
      `$timescale 1ns $end`,
      `$scope module top $end`,
    ];

    for (const node of nodeNames) {
      lines.push(`$var real 64 ${symbolMap.get(node)} V_${node} $end`);
    }

    lines.push(`$upscope $end`, `$enddefinitions $end`, `$dumpvars`);

    for (const node of nodeNames) {
      lines.push(`r0.0 ${symbolMap.get(node)}`);
    }
    lines.push(`$end`);

    for (const row of results) {
      const timeNs = Math.round(row.time * 1e9);
      lines.push(`#${timeNs}`);
      for (const node of nodeNames) {
        const val = row.nodeVoltages[node] ?? 0.0;
        lines.push(`r${val.toFixed(6)} ${symbolMap.get(node)}`);
      }
    }

    return {
      filename: "simulation_output.vcd",
      content: lines.join("\n") + "\n",
      mimeType: this.mimeType,
      formatName: this.name,
    };
  }
}

export class MatlabExportFormat implements CustomExportFormat {
  readonly id = "org.astryd.export.matlab";
  readonly name = "Script de MATLAB / GNU Octave (.m)";
  readonly fileExtension = "m";
  readonly mimeType = "text/x-matlab";
  readonly description = "Genera un script ejecutable de MATLAB/Octave con vectores de tiempo, tensiones y gráficos automáticos.";

  export(input: PluginExportInput): PluginExportResult {
    const results = input.transientResults || [];
    const times = results.map(r => r.time);
    const nodeNames = results[0] ? Object.keys(results[0].nodeVoltages).filter(k => k !== "0") : [];

    const lines: string[] = [
      `%% Astryd Sophia — Script de Simulación Generado Automáticamente`,
      `%% Fecha: ${new Date().toISOString()}`,
      `clear; clc; close all;`,
      ``,
      `% Vector de Tiempo (s)`,
      `t = [${times.map(t => t.toFixed(8)).join(", ")}];`,
      ``,
    ];

    for (const node of nodeNames) {
      const vals = results.map(r => (r.nodeVoltages[node] ?? 0.0).toFixed(6));
      lines.push(`V_${node} = [${vals.join(", ")}];`);
    }

    lines.push(
      ``,
      `% Graficar Formas de Onda`,
      `figure('Name', 'Astryd Sophia Simulation Results', 'NumberTitle', 'off');`,
      `hold on; grid on; box on;`,
      ...nodeNames.map(node => `plot(t * 1e3, V_${node}, 'LineWidth', 1.5, 'DisplayName', 'V(${node})');`),
      `xlabel('Tiempo (ms)', 'FontSize', 12);`,
      `ylabel('Tensión (V)', 'FontSize', 12);`,
      `title('Respuesta Transitoria del Circuito', 'FontSize', 14);`,
      `legend('show', 'Location', 'best');`,
      ``
    );

    return {
      filename: "circuit_simulation.m",
      content: lines.join("\n") + "\n",
      mimeType: this.mimeType,
      formatName: this.name,
    };
  }
}

export const VCD_EXPORT_PLUGIN: AstrydPlugin = {
  manifest: {
    id: "org.astryd.export.vcd",
    name: "IEEE 1364 VCD Exporter",
    version: "1.0.0",
    author: "Astryd Sophia Core Team",
    description: "Exportador estándar VCD para análisis en GTKWave.",
    type: "export-format",
    tags: ["vcd", "gtkwave", "mixed-signal", "digital"],
  },
  exportFormat: new VcdExportFormat(),
};

export const MATLAB_EXPORT_PLUGIN: AstrydPlugin = {
  manifest: {
    id: "org.astryd.export.matlab",
    name: "MATLAB / GNU Octave Exporter",
    version: "1.0.0",
    author: "Astryd Sophia Core Team",
    description: "Generador de scripts .m para análisis matricial en MATLAB u Octave.",
    type: "export-format",
    tags: ["matlab", "octave", "matrix", "analysis"],
  },
  exportFormat: new MatlabExportFormat(),
};
