import type { TimeStepResult } from "../ui/oscilloscope_panel";

export function findClosestTimeIndex(
  results: readonly TimeStepResult[],
  targetTime: number,
  previousIndex: number,
): number {
  if (results.length === 0) return 0;
  if (targetTime <= results[0].time) return 0;
  const lastIndex = results.length - 1;
  if (targetTime >= results[lastIndex].time) return lastIndex;

  const previous = results[Math.min(Math.max(previousIndex, 0), lastIndex)];
  const next = results[Math.min(previousIndex + 1, lastIndex)];
  if (previous && next && targetTime >= previous.time && targetTime <= next.time) {
    return Math.abs(previous.time - targetTime) <= Math.abs(next.time - targetTime)
      ? previousIndex
      : Math.min(previousIndex + 1, lastIndex);
  }

  let low = 0;
  let high = lastIndex;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const time = results[mid].time;
    if (time === targetTime) return mid;
    if (time < targetTime) low = mid + 1;
    else high = mid - 1;
  }

  const before = Math.max(0, high);
  const after = Math.min(lastIndex, low);
  return Math.abs(results[before].time - targetTime) <= Math.abs(results[after].time - targetTime)
    ? before
    : after;
}

export function shouldRenderPlaybackCanvas(
  now: number,
  lastRenderAt: number,
  minFrameIntervalMs = 33,
): boolean {
  return now - lastRenderAt >= minFrameIntervalMs;
}
