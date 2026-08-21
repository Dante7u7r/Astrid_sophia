/**
 * Astryd Sophia — WASM & Extensible Plugin API
 *
 * Define los contratos y tipos estandarizados para la arquitectura de plugins:
 * 1. Custom Device Models (WASM / JS): Dispositivos no lineales, memristores, sensores dinámicos, matrices jacobianas.
 * 2. Analysis Post-Processing: Post-procesado avanzado de formas de onda (THD, Factor de Potencia, FFT custom, jitter).
 * 3. Custom Export Formats: Serializadores para MATLAB, VCD (GTKWave), Touchstone S-parameters, esquemas CAD.
 */

import type { CircuitNetlist } from "../simulation/netlist_extractor";
import type { CircuitFileData } from "../persistence/circuit_file";

// ============================================================================
// METADATOS Y MANIFIESTO DEL PLUGIN
// ============================================================================

export type PluginType = "custom-device" | "analysis-post-proc" | "export-format" | "hybrid";

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly type: PluginType;
  readonly tags?: readonly string[];
  readonly wasmSupported?: boolean;
}

// ============================================================================
// 1. CONTRATO DE DISPOSITIVOS CUSTOM (CUSTOM DEVICE MODEL)
// ============================================================================

export interface DeviceEvaluationResult {
  readonly currents: Float64Array;            // Corriente por cada pin [I_0, I_1, ..., I_{n-1}] (A)
  readonly conductanceMatrix: Float64Array;   // Matriz Jacobiana N x N aplanada (G_ij = dI_i / dV_j) (S)
  readonly companionCurrents?: Float64Array;  // Corrientes de historia de Newton-Raphson I_eq (A)
  readonly nextStates?: Float64Array;         // Estados internos actualizados [s_0, s_1, ...]
}

export interface CustomDeviceModel {
  readonly deviceType: string;
  readonly displayName: string;
  readonly pinCount: number;
  readonly pinNames: readonly string[];
  readonly stateSize: number;
  readonly defaultParams: Readonly<Record<string, number>>;

  /**
   * Inicializa el vector de estados internos del dispositivo en t=0.
   */
  initState(params: Record<string, number>): Float64Array;

  /**
   * Evalúa las corrientes nodales, conductancias jacobianas y estados para el paso MNA actual.
   *
   * @param voltages Tensiones nodales aplicadas en cada terminal [V_0, V_1, ..., V_{n-1}]
   * @param states Vector de estados internos actuales
   * @param dt Paso temporal transitorio actual (s)
   * @param time Tiempo acumulado de simulación (s)
   * @param temp Temperatura del dispositivo (°C)
   * @param params Parámetros físicos configurados
   */
  evaluate(
    voltages: Float64Array,
    states: Float64Array,
    dt: number,
    time: number,
    temp: number,
    params: Record<string, number>,
  ): DeviceEvaluationResult;
}

// ============================================================================
// 2. CONTRATO DE POST-PROCESADO DE ANÁLISIS (ANALYSIS POST-PROCESSING)
// ============================================================================

export interface AnalysisPostProcInput {
  readonly mode: "TRAN" | "AC" | "DC";
  readonly time?: Float64Array | number[];
  readonly frequencies?: Float64Array | number[];
  readonly nodeVoltages: Readonly<Record<string, Float64Array | number[]>>;
  readonly branchCurrents: Readonly<Record<string, Float64Array | number[]>>;
  readonly customParams?: Readonly<Record<string, any>>;
}

export interface PostProcDataSeries {
  readonly label: string;
  readonly x: Float64Array | number[];
  readonly y: Float64Array | number[];
  readonly unitX: string;
  readonly unitY: string;
}

export interface PostProcScalarMetric {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly description: string;
  readonly pass?: boolean;
}

export interface AnalysisPostProcOutput {
  readonly pluginId: string;
  readonly title: string;
  readonly series: Readonly<Record<string, PostProcDataSeries>>;
  readonly metrics: Readonly<Record<string, PostProcScalarMetric>>;
  readonly notes?: readonly string[];
}

export interface AnalysisPostProcessor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly supportedModes: readonly ("TRAN" | "AC" | "DC")[];
  process(input: AnalysisPostProcInput): AnalysisPostProcOutput;
}

// ============================================================================
// 3. CONTRATO DE FORMATOS DE EXPORTACIÓN (CUSTOM EXPORT FORMATS)
// ============================================================================

export interface PluginExportInput {
  readonly circuitSnapshot?: CircuitFileData;
  readonly netlist: CircuitNetlist;
  readonly transientResults?: Array<{
    time: number;
    nodeVoltages: Record<string, number>;
    branchCurrents: Record<string, number>;
  }>;
  readonly acResults?: {
    frequencies: number[];
    magnitudesDb: number[];
    phasesDeg: number[];
  };
  readonly options?: Readonly<Record<string, any>>;
}

export interface PluginExportResult {
  readonly filename: string;
  readonly content: string | Uint8Array;
  readonly mimeType: string;
  readonly formatName: string;
}

export interface CustomExportFormat {
  readonly id: string;
  readonly name: string;
  readonly fileExtension: string;
  readonly mimeType: string;
  readonly description: string;
  export(input: PluginExportInput): Promise<PluginExportResult> | PluginExportResult;
}

// ============================================================================
// 4. ESTRUCTURA COMPLETA DEL PLUGIN
// ============================================================================

export interface AstrydPlugin {
  readonly manifest: PluginManifest;
  readonly deviceModel?: CustomDeviceModel;
  readonly postProcessor?: AnalysisPostProcessor;
  readonly exportFormat?: CustomExportFormat;
  readonly wasmModule?: WebAssembly.Module;
  readonly wasmInstance?: WebAssembly.Instance;
}
