/**
 * Astryd Sophia — WASM Plugin Host & Lifecycle Manager
 *
 * Administra el ciclo de vida, compilación WebAssembly y ejecución en sandbox
 * de plugins de dispositivos personalizados, post-procesadores de formas de onda
 * y formateadores de exportación.
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
  PluginManifest,
} from "./wasm_plugin_api";
import {
  MEMRISTOR_PLUGIN,
  POWER_THD_PLUGIN,
  VCD_EXPORT_PLUGIN,
  MATLAB_EXPORT_PLUGIN,
} from "./builtin_plugins";

export class WasmPluginHost {
  private readonly plugins = new Map<string, AstrydPlugin>();
  private readonly deviceModels = new Map<string, CustomDeviceModel>();
  private readonly postProcessors = new Map<string, AnalysisPostProcessor>();
  private readonly exportFormats = new Map<string, CustomExportFormat>();

  constructor(loadBuiltins = true) {
    if (loadBuiltins) {
      this.registerPlugin(MEMRISTOR_PLUGIN);
      this.registerPlugin(POWER_THD_PLUGIN);
      this.registerPlugin(VCD_EXPORT_PLUGIN);
      this.registerPlugin(MATLAB_EXPORT_PLUGIN);
    }
  }

  /**
   * Registra un plugin de JavaScript / TypeScript o cargado previamente.
   */
  registerPlugin(plugin: AstrydPlugin): void {
    this.plugins.set(plugin.manifest.id, plugin);

    if (plugin.deviceModel) {
      this.deviceModels.set(plugin.deviceModel.deviceType, plugin.deviceModel);
    }

    if (plugin.postProcessor) {
      this.postProcessors.set(plugin.postProcessor.id, plugin.postProcessor);
    }

    if (plugin.exportFormat) {
      this.exportFormats.set(plugin.exportFormat.id, plugin.exportFormat);
    }
  }

  /**
   * Carga e instancia un módulo binario WebAssembly (.wasm) y lo envuelve como plugin.
   */
  async loadWasmPlugin(
    bytes: ArrayBuffer | Uint8Array,
    manifest: PluginManifest,
    imports: WebAssembly.Imports = {},
  ): Promise<AstrydPlugin> {
    const wasmModule = await WebAssembly.compile(bytes);
    const wasmInstance = await WebAssembly.instantiate(wasmModule, imports);

    let deviceModel: CustomDeviceModel | undefined;

    // Si el módulo WASM exporta funciones de dispositivo custom
    const exports = wasmInstance.exports as Record<string, any>;
    if (typeof exports.evaluate_device === "function") {
      const pinCount = typeof exports.get_pin_count === "function" ? exports.get_pin_count() : 2;
      const stateSize = typeof exports.get_state_size === "function" ? exports.get_state_size() : 1;

      deviceModel = {
        deviceType: manifest.id,
        displayName: manifest.name,
        pinCount,
        pinNames: Array.from({ length: pinCount }, (_, i) => `P${i + 1}`),
        stateSize,
        defaultParams: {},
        initState: () => new Float64Array(stateSize).fill(0),
        evaluate: (
          voltages: Float64Array,
          states: Float64Array,
          dt: number,
          time: number,
          temp: number,
        ): DeviceEvaluationResult => {
          // Si el módulo WASM tiene memoria compartida
          const mem = exports.memory as WebAssembly.Memory | undefined;
          if (mem) {
            // Invocar wrapper de evaluación WASM
            const ptr = typeof exports.alloc_buffer === "function" ? exports.alloc_buffer(64) : 0;
            const res = exports.evaluate_device(ptr, voltages[0], voltages[1], states[0], dt, time, temp);
            return {
              currents: new Float64Array([res, -res]),
              conductanceMatrix: new Float64Array([1e-3, -1e-3, -1e-3, 1e-3]),
              nextStates: new Float64Array(states),
            };
          }

          // Fallback a llamada directa
          const iVal = exports.evaluate_device(voltages[0], voltages[1], states[0], dt);
          return {
            currents: new Float64Array([iVal, -iVal]),
            conductanceMatrix: new Float64Array([1e-3, -1e-3, -1e-3, 1e-3]),
            nextStates: new Float64Array(states),
          };
        },
      };
    }

    const plugin: AstrydPlugin = {
      manifest,
      wasmModule,
      wasmInstance,
      deviceModel,
    };

    this.registerPlugin(plugin);
    return plugin;
  }

  /**
   * Da de baja un plugin por su identificador.
   */
  unregisterPlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    if (plugin.deviceModel) {
      this.deviceModels.delete(plugin.deviceModel.deviceType);
    }
    if (plugin.postProcessor) {
      this.postProcessors.delete(plugin.postProcessor.id);
    }
    if (plugin.exportFormat) {
      this.exportFormats.delete(plugin.exportFormat.id);
    }

    return this.plugins.delete(pluginId);
  }

  getPlugin(id: string): AstrydPlugin | undefined {
    return this.plugins.get(id);
  }

  getAllPlugins(): AstrydPlugin[] {
    return Array.from(this.plugins.values());
  }

  getDeviceModel(deviceType: string): CustomDeviceModel | undefined {
    return this.deviceModels.get(deviceType);
  }

  getAllDeviceModels(): CustomDeviceModel[] {
    return Array.from(this.deviceModels.values());
  }

  getPostProcessor(id: string): AnalysisPostProcessor | undefined {
    return this.postProcessors.get(id);
  }

  getAllPostProcessors(): AnalysisPostProcessor[] {
    return Array.from(this.postProcessors.values());
  }

  getExportFormat(id: string): CustomExportFormat | undefined {
    return this.exportFormats.get(id);
  }

  getAllExportFormats(): CustomExportFormat[] {
    return Array.from(this.exportFormats.values());
  }

  /**
   * Ejecuta la evaluación de un modelo de dispositivo registrado.
   */
  evaluateDevice(
    deviceType: string,
    voltages: Float64Array,
    states: Float64Array,
    dt: number,
    time: number,
    temp: number,
    params: Record<string, number> = {},
  ): DeviceEvaluationResult | null {
    const model = this.deviceModels.get(deviceType);
    if (!model) return null;
    return model.evaluate(voltages, states, dt, time, temp, params);
  }

  /**
   * Ejecuta un post-procesador de análisis registrado sobre resultados de simulación.
   */
  executePostProcessor(
    postProcessorId: string,
    input: AnalysisPostProcInput,
  ): AnalysisPostProcOutput | null {
    const proc = this.postProcessors.get(postProcessorId);
    if (!proc) return null;
    return proc.process(input);
  }

  /**
   * Ejecuta un formateador de exportación registrado.
   */
  async executeExport(
    exportFormatId: string,
    input: PluginExportInput,
  ): Promise<PluginExportResult | null> {
    const exporter = this.exportFormats.get(exportFormatId);
    if (!exporter) return null;
    return await exporter.export(input);
  }
}

export const globalWasmPluginHost = new WasmPluginHost();
