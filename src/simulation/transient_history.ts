import type { TimeStepResult } from "../ui/oscilloscope_panel";

export const MAX_LIVE_TRANSIENT_SAMPLES = 60_000;
const LIVE_HISTORY_TRIM_CHUNK = 6_000;

export function appendLiveTransientSample(
  results: TimeStepResult[],
  sample: TimeStepResult,
  maxSamples = MAX_LIVE_TRANSIENT_SAMPLES,
): void {
  if (maxSamples < 2) throw new RangeError("maxSamples debe ser mayor o igual que 2");

  // Si el tiempo retrocede (nueva corrida o reinicio del transitorio), reiniciar buffer para mantener monotonía
  if (results.length > 0 && sample.time < results[results.length - 1]!.time) {
    results.length = 0;
  }

  if (results.length >= maxSamples) {
    const trimCount = Math.min(
      results.length,
      Math.max(1, Math.min(LIVE_HISTORY_TRIM_CHUNK, Math.ceil(maxSamples * 0.1))),
    );
    // En lugar de splice(0, trimCount) que es O(N) y desencadena GC re-allocations masivas,
    // desplazamos los elementos in-place O(1) relativo y truncamos la longitud.
    const remaining = results.length - trimCount;
    for (let i = 0; i < remaining; i++) {
      results[i] = results[i + trimCount]!;
    }
    results.length = remaining;
  }
  results.push(sample);
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Algoritmo LTTB (Largest-Triangle-Three-Buckets) para compresión y subsampliado
 * de series temporales de alta resolución manteniendo picos, cruces por cero y
 * formas de onda sin alias visual con memoria O(1).
 */
export function lttbDownsample(data: readonly Point2D[], threshold: number): Point2D[] {
  const len = data.length;
  if (threshold >= len || threshold <= 2) {
    return data.slice();
  }

  const sampled: Point2D[] = [];
  sampled.push(data[0]!);

  const bucketSize = (len - 2) / (threshold - 2);

  let a = 0; // Índice del punto seleccionado en el cubo anterior

  for (let i = 0; i < threshold - 2; i++) {
    // 1. Calcular el punto promedio del cubo C (siguiente cubo)
    let avgX = 0;
    let avgY = 0;
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len);
    const avgRangeLength = avgRangeEnd - avgRangeStart;

    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += data[j]!.x;
      avgY += data[j]!.y;
    }
    if (avgRangeLength > 0) {
      avgX /= avgRangeLength;
      avgY /= avgRangeLength;
    }

    // 2. Buscar el punto en el cubo B actual que maximice el área del triángulo (A, B, C)
    const rangeOffs = Math.floor(i * bucketSize) + 1;
    const rangeTo = Math.floor((i + 1) * bucketSize) + 1;

    const pointA = data[a]!;
    let maxArea = -1;
    let maxAreaIndex = rangeOffs;

    for (let j = rangeOffs; j < rangeTo; j++) {
      const pointB = data[j]!;
      const area = Math.abs(
        (pointA.x - avgX) * (pointB.y - pointA.y) - (pointA.x - pointB.x) * (avgY - pointA.y),
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    sampled.push(data[maxAreaIndex]!);
    a = maxAreaIndex;
  }

  sampled.push(data[len - 1]!);
  return sampled;
}
