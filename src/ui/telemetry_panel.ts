import { safeInvoke } from "../simulation/tauri_mock";

export class TelemetryPanel {
  private telemetryRamText: HTMLElement | null = null;
  private telemetryCpuText: HTMLElement | null = null;
  private intervalId: number | null = null;

  constructor() {
    this.telemetryRamText = document.querySelector("#telemetry-ram-text");
    this.telemetryCpuText = document.querySelector("#telemetry-cpu-text");
  }

  public start() {
    const updateTelemetry = async () => {
      try {
        const data = await safeInvoke<any>("get_performance_telemetry");
        if (this.telemetryRamText) {
          this.telemetryRamText.textContent = data.ramFormatted || `${data.memory_used_mb || 200} MB`;
        }
        if (this.telemetryCpuText) {
          const cpuVal = data.cpuPercent !== undefined ? data.cpuPercent : data.cpu_usage;
          this.telemetryCpuText.textContent = `${(cpuVal || 0).toFixed(1)} %`;
        }
      } catch (err) {

        if (this.telemetryRamText) {
          this.telemetryRamText.textContent = "TS Local (N/A)";
        }
        if (this.telemetryCpuText) {
          this.telemetryCpuText.textContent = "0.0 %";
        }
      }
    };

    updateTelemetry();
    this.intervalId = window.setInterval(updateTelemetry, 3000);
  }

  public stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
