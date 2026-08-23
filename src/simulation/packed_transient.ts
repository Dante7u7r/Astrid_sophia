// ==========================================================================
// PACKED TRANSIENT VIEW — Vista de alta eficiencia para transitorios empaquetados
// ==========================================================================
// Responsabilidades:
//   1. Recibir matrices contiguas de memoria (Float64Array) desde el backend Rust.
//   2. Evitar la instanciación de millones de objetos Record<string, number>.
//   3. Proveer acceso O(1) a voltajes y corrientes por nodo/rama y paso de tiempo.
//   4. Permitir conversión bidireccional bajo demanda con TimeStepResult[].
// ==========================================================================

import type { TimeStepResult } from "../ui/oscilloscope_panel";

export interface RawPackedTransientPayload {
  nodeNames: string[];
  branchNames: string[];
  times: number[] | Float64Array;
  nodeVoltages: number[] | Float64Array;
  branchCurrents: number[] | Float64Array;
}

export class PackedTransientView {
  readonly nodeNames: readonly string[];
  readonly branchNames: readonly string[];
  readonly times: Float64Array;
  readonly nodeVoltages: Float64Array;
  readonly branchCurrents: Float64Array;

  private readonly nodeIndexMap: Map<string, number>;
  private readonly branchIndexMap: Map<string, number>;

  constructor(payload: RawPackedTransientPayload) {
    this.nodeNames = Object.freeze([...payload.nodeNames]);
    this.branchNames = Object.freeze([...payload.branchNames]);

    this.times = payload.times instanceof Float64Array ? payload.times : new Float64Array(payload.times);
    this.nodeVoltages = payload.nodeVoltages instanceof Float64Array ? payload.nodeVoltages : new Float64Array(payload.nodeVoltages);
    this.branchCurrents = payload.branchCurrents instanceof Float64Array ? payload.branchCurrents : new Float64Array(payload.branchCurrents);

    this.nodeIndexMap = new Map();
    for (let i = 0; i < this.nodeNames.length; i++) {
      this.nodeIndexMap.set(this.nodeNames[i]!, i);
    }

    this.branchIndexMap = new Map();
    for (let i = 0; i < this.branchNames.length; i++) {
      this.branchIndexMap.set(this.branchNames[i]!, i);
    }
  }

  /** Cantidad total de pasos de tiempo */
  get stepCount(): number {
    return this.times.length;
  }

  /** Retorna el tiempo en el paso especificado */
  getTime(stepIndex: number): number {
    return this.times[stepIndex] ?? 0.0;
  }

  /** Retorna el voltaje de un nodo en un paso específico en O(1) */
  getNodeVoltage(nodeName: string, stepIndex: number): number {
    const nodeIdx = this.nodeIndexMap.get(nodeName);
    if (nodeIdx === undefined || stepIndex < 0 || stepIndex >= this.stepCount) {
      return 0.0;
    }
    const offset = stepIndex * this.nodeNames.length + nodeIdx;
    return this.nodeVoltages[offset] ?? 0.0;
  }

  /** Retorna la corriente de una rama en un paso específico en O(1) */
  getBranchCurrent(branchName: string, stepIndex: number): number {
    const branchIdx = this.branchIndexMap.get(branchName);
    if (branchIdx === undefined || stepIndex < 0 || stepIndex >= this.stepCount) {
      return 0.0;
    }
    const offset = stepIndex * this.branchNames.length + branchIdx;
    return this.branchCurrents[offset] ?? 0.0;
  }

  /**
   * Extrae el vector completo de voltajes para un nodo en memoria contigua (Float64Array)
   */
  getNodeWaveform(nodeName: string): Float64Array {
    const count = this.stepCount;
    const waveform = new Float64Array(count);
    const nodeIdx = this.nodeIndexMap.get(nodeName);
    if (nodeIdx === undefined) return waveform;

    const numNodes = this.nodeNames.length;
    for (let s = 0; s < count; s++) {
      waveform[s] = this.nodeVoltages[s * numNodes + nodeIdx]!;
    }
    return waveform;
  }

  /**
   * Construye un TimeStepResult puntual bajo demanda sin deserializar el dataset completo.
   */
  getTimeStep(stepIndex: number): TimeStepResult | undefined {
    if (stepIndex < 0 || stepIndex >= this.stepCount) return undefined;

    const time = this.times[stepIndex]!;
    const nodeVoltages: Record<string, number> = {};
    const numNodes = this.nodeNames.length;
    const nodeOffset = stepIndex * numNodes;
    for (let n = 0; n < numNodes; n++) {
      nodeVoltages[this.nodeNames[n]!] = this.nodeVoltages[nodeOffset + n]!;
    }

    const branchCurrents: Record<string, number> = {};
    const numBranches = this.branchNames.length;
    const branchOffset = stepIndex * numBranches;
    for (let b = 0; b < numBranches; b++) {
      branchCurrents[this.branchNames[b]!] = this.branchCurrents[branchOffset + b]!;
    }

    return {
      time,
      nodeVoltages,
      branchCurrents,
    };
  }

  /**
   * Desempaqueta la vista a la colección estándar TimeStepResult[] para compatibilidad con código legado.
   */
  unpack(): TimeStepResult[] {
    const count = this.stepCount;
    const results: TimeStepResult[] = new Array(count);
    for (let i = 0; i < count; i++) {
      results[i] = this.getTimeStep(i)!;
    }
    return results;
  }

  /**
   * Crea un PackedTransientView a partir de un arreglo TimeStepResult[].
   */
  static fromTimeSteps(steps: readonly TimeStepResult[]): PackedTransientView {
    if (steps.length === 0) {
      return new PackedTransientView({
        nodeNames: [],
        branchNames: [],
        times: new Float64Array(0),
        nodeVoltages: new Float64Array(0),
        branchCurrents: new Float64Array(0),
      });
    }

    const nodeSet = new Set<string>();
    const branchSet = new Set<string>();
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      for (const k of Object.keys(step.nodeVoltages)) {
        nodeSet.add(k);
      }
      if (step.branchCurrents) {
        for (const k of Object.keys(step.branchCurrents)) {
          branchSet.add(k);
        }
      }
    }

    const nodeNames = Array.from(nodeSet).sort();
    const branchNames = Array.from(branchSet).sort();
    const stepCount = steps.length;
    const numNodes = nodeNames.length;
    const numBranches = branchNames.length;

    const times = new Float64Array(stepCount);
    const nodeVoltages = new Float64Array(stepCount * numNodes);
    const branchCurrents = new Float64Array(stepCount * numBranches);

    for (let s = 0; s < stepCount; s++) {
      const step = steps[s]!;
      times[s] = step.time;

      const nodeOffset = s * numNodes;
      for (let n = 0; n < numNodes; n++) {
        nodeVoltages[nodeOffset + n] = step.nodeVoltages[nodeNames[n]!] ?? 0.0;
      }

      const branchOffset = s * numBranches;
      for (let b = 0; b < numBranches; b++) {
        branchCurrents[branchOffset + b] = step.branchCurrents?.[branchNames[b]!] ?? 0.0;
      }
    }

    return new PackedTransientView({
      nodeNames,
      branchNames,
      times,
      nodeVoltages,
      branchCurrents,
    });
  }
}
