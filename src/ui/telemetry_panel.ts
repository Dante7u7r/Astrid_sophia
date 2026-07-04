import { safeInvoke } from "../simulation/tauri_mock";

export class TelemetryPanel {
  public static lastError: string | null = null;

  public static showToast(
    message: string,
    type: 'success' | 'warning' | 'error' | 'info' = 'error',
    title?: string
  ): void {
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
    titleDiv.textContent = title || defaultTitles[type];

    const messageDiv = document.createElement('div');
    messageDiv.className = 'toast-message';
    messageDiv.textContent = message;

    content.appendChild(titleDiv);
    content.appendChild(messageDiv);

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

    // 7. Auto-destruct after 4 seconds
    setTimeout(removeCard, 4000);
  }

  public static logError(errorMsg: string): void {
    TelemetryPanel.lastError = errorMsg;
    console.error(`[TelemetryPanel Error Log] ${errorMsg}`);
    
    // Automatically trigger a Toast error notification for logged simulation errors
    TelemetryPanel.showToast(errorMsg, 'error');
  }

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
