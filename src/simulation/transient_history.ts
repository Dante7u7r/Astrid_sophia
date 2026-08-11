import type { TimeStepResult } from "../ui/oscilloscope_panel";

export const MAX_LIVE_TRANSIENT_SAMPLES = 60_000;
const LIVE_HISTORY_TRIM_CHUNK = 6_000;

export function appendLiveTransientSample(
  results: TimeStepResult[],
  sample: TimeStepResult,
  maxSamples = MAX_LIVE_TRANSIENT_SAMPLES,
): void {
  if (maxSamples < 2) throw new RangeError("maxSamples debe ser mayor o igual que 2");

  if (results.length >= maxSamples) {
    const trimCount = Math.min(
      results.length,
      Math.max(1, Math.min(LIVE_HISTORY_TRIM_CHUNK, Math.ceil(maxSamples * 0.1))),
    );
    results.splice(0, trimCount);
  }
  results.push(sample);
}
