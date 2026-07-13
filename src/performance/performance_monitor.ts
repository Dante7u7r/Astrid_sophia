export interface PerformanceSnapshot {
  readonly canvasFrames: number;
  readonly oscilloscopeFrames: number;
  readonly skippedDmmUpdates: number;
  readonly fpsEstimate: number;
}

export class PerformanceMonitor {
  private canvasFrames = 0;
  private oscilloscopeFrames = 0;
  private skippedDmmUpdates = 0;
  private lastSampleAt = performance.now();
  private framesAtLastSample = 0;
  private fpsEstimate = 0;

  public recordCanvasFrame(): void {
    this.canvasFrames += 1;
    this.updateFpsEstimate();
  }

  public recordOscilloscopeFrame(): void {
    this.oscilloscopeFrames += 1;
  }

  public recordSkippedDmmUpdate(): void {
    this.skippedDmmUpdates += 1;
  }

  public snapshot(): PerformanceSnapshot {
    this.updateFpsEstimate();
    return {
      canvasFrames: this.canvasFrames,
      oscilloscopeFrames: this.oscilloscopeFrames,
      skippedDmmUpdates: this.skippedDmmUpdates,
      fpsEstimate: this.fpsEstimate,
    };
  }

  private updateFpsEstimate(): void {
    const now = performance.now();
    const elapsedMs = now - this.lastSampleAt;
    if (elapsedMs < 1000) return;

    const frames = this.canvasFrames - this.framesAtLastSample;
    this.fpsEstimate = frames / (elapsedMs / 1000);
    this.framesAtLastSample = this.canvasFrames;
    this.lastSampleAt = now;
  }
}
