import { safeInvoke } from "../simulation/tauri_mock";
import type { PerformanceSnapshot } from "../performance/performance_monitor";
import { recordPerformance, recordUiError } from "../feedback/instrumentation";

interface PerformanceTelemetryPayload {
  ramFormatted?: string;
  memory_used_mb?: number;
  cpuPercent?: number;
  cpu_usage?: number;
}

export class TelemetryPanel {
  public static lastError: string | null = null;

  public static showToast(
    message: string,
    type: 'success' | 'warning' | 'error' | 'info' = 'error',
    titleOrOptions?: string | {
      title?: string;
      durationMs?: number;
      actions?: Array<{ label: string; primary?: boolean; onClick: () => void }>;
    }
  ): void {
    if (typeof document === 'undefined') return;
    const options = typeof titleOrOptions === 'object' && titleOrOptions !== null
      ? titleOrOptions
      : { title: typeof titleOrOptions === 'string' ? titleOrOptions : undefined };

    const durationMs = options.durationMs !== undefined
      ? options.durationMs
      : type === 'error' ? 7000 : 4000;

    // 1. Create or get container
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    // 2. Create card element
    const card = document.createElement('div');
    card.className = `toast-card toast-${type}`;

    // 3. Icon
    const icons = {
      success: '✅',
      warning: '⚠️',
      error: '❌',
      info: 'ℹ️'
    };
    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = icons[type];

    // 4. Content layout
    const content = document.createElement('div');
    content.className = 'toast-content';

    const defaultTitles = {
      success: 'Éxito',
      warning: 'Advertencia',
      error: 'Error de Simulación',
      info: 'Información'
    };
    const titleDiv = document.createElement('div');
    titleDiv.className = 'toast-title';
    titleDiv.textContent = options.title || defaultTitles[type];

    const messageDiv = document.createElement('div');
    messageDiv.className = 'toast-message';
    messageDiv.textContent = message;

    content.appendChild(titleDiv);
    content.appendChild(messageDiv);

    // Actions
    if (options.actions && options.actions.length > 0) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'toast-actions';
      actionsDiv.style.cssText = 'display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;';
      for (const action of options.actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn-toast-action ${action.primary ? 'btn-toast-primary' : ''}`;
        btn.textContent = action.label;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          action.onClick();
        });
        actionsDiv.appendChild(btn);
      }
      content.appendChild(actionsDiv);
    }

    // 5. Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.type = 'button';

    card.appendChild(iconSpan);
    card.appendChild(content);
    card.appendChild(closeBtn);

    container.appendChild(card);

    // 6. Interaction events
    const removeCard = () => {
      if (card.parentElement) {
        card.classList.add('toast-closing');
        setTimeout(() => {
          if (card.parentElement) {
            container.removeChild(card);
          }
        }, 300);
      }
    };

    closeBtn.addEventListener('click', removeCard);

    // 7. Auto-destruct after durationMs (if > 0)
    if (durationMs > 0) {
      setTimeout(removeCard, durationMs);
    }
  }

  public static logError(errorMsg: string): void {
    TelemetryPanel.lastError = errorMsg;
    recordUiError("simulation", "UI_SIMULATION_ERROR", errorMsg);
    console.error(`[TelemetryPanel Error Log] ${errorMsg}`);

    // Automatically trigger a Toast error notification for logged simulation errors
    TelemetryPanel.showToast(errorMsg, 'error');
  }

  private telemetryRamText: HTMLElement | null = null;
  private telemetryCpuText: HTMLElement | null = null;
  private telemetryFpsText: HTMLElement | null = null;
  private intervalId: number | null = null;
  private fpsIntervalId: number | null = null;

  constructor(private readonly getPerformanceSnapshot?: () => PerformanceSnapshot) {
    this.telemetryRamText = document.querySelector("#telemetry-ram-text");
    this.telemetryCpuText = document.querySelector("#telemetry-cpu-text");
    this.telemetryFpsText = document.querySelector("#telemetry-fps-text");
  }

  public start() {
    const updateTelemetry = async () => {
      try {
        const data = await safeInvoke<PerformanceTelemetryPayload>("get_performance_telemetry");
        if (this.telemetryRamText) {
          this.telemetryRamText.textContent = data.ramFormatted || `${data.memory_used_mb || 200} MB`;
        }
        if (this.telemetryCpuText) {
          const cpuVal = data.cpuPercent !== undefined ? data.cpuPercent : data.cpu_usage;
          this.telemetryCpuText.textContent = `${(cpuVal || 0).toFixed(1)} %`;
        }
        const snapshot = this.updateLocalPerformance();
        if (snapshot) {
          recordPerformance({
            fps: snapshot.fpsEstimate,
            cpuPercent: data.cpuPercent ?? data.cpu_usage ?? 0,
            ramBytes: Math.round((data.memory_used_mb ?? 0) * 1024 * 1024),
            canvasFrames: snapshot.canvasFrames,
            oscilloscopeFrames: snapshot.oscilloscopeFrames,
            skippedDmmUpdates: snapshot.skippedDmmUpdates,
          });
        }
      } catch (err) {

        if (this.telemetryRamText) {
          this.telemetryRamText.textContent = "TS Local (N/A)";
        }
        if (this.telemetryCpuText) {
          this.telemetryCpuText.textContent = "0.0 %";
        }
        this.updateLocalPerformance();
      }
    };

    updateTelemetry();
    this.updateLocalPerformance();
    this.intervalId = window.setInterval(updateTelemetry, 3000);
    this.fpsIntervalId = window.setInterval(() => this.updateLocalPerformance(), 1000);
  }

  public stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.fpsIntervalId !== null) {
      clearInterval(this.fpsIntervalId);
      this.fpsIntervalId = null;
    }
  }

  private updateLocalPerformance(): PerformanceSnapshot | null {
    if (!this.getPerformanceSnapshot) return null;
    const snapshot = this.getPerformanceSnapshot();
    const fps = Math.round(snapshot.fpsEstimate);
    if (this.telemetryFpsText) {
      this.telemetryFpsText.textContent = `${Math.max(0, fps)} FPS`;
    }
    return snapshot;
  }
}
