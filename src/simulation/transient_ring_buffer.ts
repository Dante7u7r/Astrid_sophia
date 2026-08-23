// ==========================================================================
// TRANSIENT RING BUFFER — Búfer circular de alta eficiencia para telemetría
// ==========================================================================
// Responsabilidades:
//   1. Preasignar capacidad fija para muestras transitorias de simulación.
//   2. Garantizar inserción O(1) en streaming continuo sin pausas de GC
//      (Garbage Collection) en sesiones de simulación de larga duración.
//   3. Proveer indexación lógica monótona [0..length-1] (0: más antiguo,
//      length-1: más reciente) sobre almacenamiento circular físico.
//   4. Downsample LTTB (Largest-Triangle-Three-Buckets) nativo sobre el anillo.
// ==========================================================================

import type { TimeStepResult } from "../ui/oscilloscope_panel";
import type { Point2D } from "./transient_history";

export const DEFAULT_RING_CAPACITY = 100_000;

export class TransientRingBuffer {
  private readonly buffer: (TimeStepResult | null)[];
  private readonly _capacity: number;
  private head = 0; // Próxima posición de escritura física
  private _length = 0; // Cantidad actual de elementos almacenados (0 <= _length <= _capacity)

  constructor(capacity = DEFAULT_RING_CAPACITY) {
    if (capacity < 2) {
      throw new RangeError("La capacidad del TransientRingBuffer debe ser al menos 2.");
    }
    this._capacity = Math.floor(capacity);
    this.buffer = new Array(this._capacity).fill(null);
  }

  /** Capacidad máxima de muestras antes de sobrescribir las más antiguas */
  get capacity(): number {
    return this._capacity;
  }

  /** Cantidad actual de muestras disponibles */
  get length(): number {
    return this._length;
  }

  /** Retorna true si el búfer está completamente lleno */
  get isFull(): boolean {
    return this._length === this._capacity;
  }

  /**
   * Inserta una nueva muestra en el búfer circular en O(1).
   * Si el tiempo de la nueva muestra retrocede (reinicio de simulación),
   * el búfer se limpia automáticamente para preservar monotonía temporal.
   */
  push(sample: TimeStepResult): void {
    if (this._length > 0) {
      const latest = this.getLatest();
      if (latest && sample.time < latest.time) {
        this.clear();
      }
    }

    this.buffer[this.head] = sample;
    this.head = (this.head + 1) % this._capacity;

    if (this._length < this._capacity) {
      this._length++;
    }
  }

  /**
   * Inserta múltiples muestras de forma secuencial y eficiente.
   */
  pushBatch(samples: readonly TimeStepResult[]): void {
    for (let i = 0; i < samples.length; i++) {
      this.push(samples[i]!);
    }
  }

  /**
   * Accede a un elemento mediante índice lógico (0 = muestra más antigua, length - 1 = más reciente).
   */
  get(logicalIndex: number): TimeStepResult | undefined {
    if (logicalIndex < 0 || logicalIndex >= this._length) {
      return undefined;
    }

    // El elemento más antiguo (logicalIndex 0) está en (head - length + capacity) % capacity
    const physicalStart = (this.head - this._length + this._capacity) % this._capacity;
    const physicalIndex = (physicalStart + logicalIndex) % this._capacity;

    return this.buffer[physicalIndex] ?? undefined;
  }

  /**
   * Retorna la muestra más reciente (tiempo más alto) en O(1).
   */
  getLatest(): TimeStepResult | undefined {
    if (this._length === 0) return undefined;
    const lastPhysicalIndex = (this.head - 1 + this._capacity) % this._capacity;
    return this.buffer[lastPhysicalIndex] ?? undefined;
  }

  /**
   * Retorna la muestra más antigua disponible en O(1).
   */
  getOldest(): TimeStepResult | undefined {
    if (this._length === 0) return undefined;
    return this.get(0);
  }

  /**
   * Reinicia el búfer a longitud 0 sin reasignar el array subyacente.
   */
  clear(): void {
    this.head = 0;
    this._length = 0;
    for (let i = 0; i < this._capacity; i++) {
      this.buffer[i] = null;
    }
  }

  /**
   * Exporta las muestras actuales a un array ordenado [más antiguo ... más reciente].
   */
  toArray(): TimeStepResult[] {
    const result: TimeStepResult[] = new Array(this._length);
    for (let i = 0; i < this._length; i++) {
      result[i] = this.get(i)!;
    }
    return result;
  }

  /**
   * Algoritmo LTTB directamente aplicado sobre el búfer circular para extraer
   * la serie temporal de un nodo específico sin crear arrays intermedios.
   */
  downsampleNodeLttb(nodeName: string, threshold: number): Point2D[] {
    const len = this._length;
    if (len === 0) return [];
    if (threshold >= len || threshold <= 2) {
      const allPoints: Point2D[] = new Array(len);
      for (let i = 0; i < len; i++) {
        const item = this.get(i)!;
        allPoints[i] = {
          x: item.time,
          y: item.nodeVoltages[nodeName] ?? 0.0,
        };
      }
      return allPoints;
    }

    const sampled: Point2D[] = [];
    const firstItem = this.get(0)!;
    sampled.push({
      x: firstItem.time,
      y: firstItem.nodeVoltages[nodeName] ?? 0.0,
    });

    const bucketSize = (len - 2) / (threshold - 2);
    let a = 0; // Índice lógico del punto anterior seleccionado

    for (let i = 0; i < threshold - 2; i++) {
      let avgX = 0;
      let avgY = 0;
      const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
      const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len);
      const avgRangeLength = avgRangeEnd - avgRangeStart;

      for (let j = avgRangeStart; j < avgRangeEnd; j++) {
        const item = this.get(j)!;
        avgX += item.time;
        avgY += item.nodeVoltages[nodeName] ?? 0.0;
      }

      if (avgRangeLength > 0) {
        avgX /= avgRangeLength;
        avgY /= avgRangeLength;
      }

      const rangeOffs = Math.floor(i * bucketSize) + 1;
      const rangeTo = Math.floor((i + 1) * bucketSize) + 1;

      const itemA = this.get(a)!;
      const ptA_x = itemA.time;
      const ptA_y = itemA.nodeVoltages[nodeName] ?? 0.0;

      let maxArea = -1;
      let maxAreaIndex = rangeOffs;

      for (let j = rangeOffs; j < rangeTo; j++) {
        const itemJ = this.get(j)!;
        const ptJ_x = itemJ.time;
        const ptJ_y = itemJ.nodeVoltages[nodeName] ?? 0.0;

        const area = Math.abs(
          (ptA_x - avgX) * (ptJ_y - ptA_y) - (ptA_x - ptJ_x) * (avgY - ptA_y),
        );
        if (area > maxArea) {
          maxArea = area;
          maxAreaIndex = j;
        }
      }

      const selected = this.get(maxAreaIndex)!;
      sampled.push({
        x: selected.time,
        y: selected.nodeVoltages[nodeName] ?? 0.0,
      });
      a = maxAreaIndex;
    }

    const lastItem = this.get(len - 1)!;
    sampled.push({
      x: lastItem.time,
      y: lastItem.nodeVoltages[nodeName] ?? 0.0,
    });

    return sampled;
  }
}
