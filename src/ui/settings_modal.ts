export const DEFAULT_TRANSIENT_DURATION_SECONDS = 10;

export interface SimulationSettings {
  dt: number;
  tolerance: number;
  maxIterations: number;
  /** Duración física de una corrida TRAN. Opcional para abrir archivos previos. */
  transientDuration?: number;
  currentFlowMode?: "conventional" | "electron";
  currentAnimationSpeed?: number;
  showCurrentAnimation?: boolean;
  showThermalHeatmap?: boolean;
  showReactiveFields?: boolean;
  showTelemetryHud?: boolean;
}

export class SettingsModal {
  private settingsModal: HTMLElement | null = null;
  private settingsTriggerBtn: HTMLButtonElement | null = null;
  private btnCancelSettings: HTMLButtonElement | null = null;
  private btnSaveSettings: HTMLButtonElement | null = null;

  private dtInput: HTMLInputElement | null = null;
  private transientDurationInput: HTMLInputElement | null = null;
  private tolInput: HTMLInputElement | null = null;
  private iterInput: HTMLInputElement | null = null;
  private flowModeInput: HTMLSelectElement | null = null;
  private flowSpeedInput: HTMLSelectElement | null = null;
  private showCurrentAnimInput: HTMLInputElement | null = null;
  private showThermalHeatmapInput: HTMLInputElement | null = null;
  private showReactiveFieldsInput: HTMLInputElement | null = null;
  private showTelemetryHudInput: HTMLInputElement | null = null;
  private appViewport: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;

  private settings: SimulationSettings;
  private onSaveCallback: (newSettings: SimulationSettings) => void;

  constructor(initialSettings: SimulationSettings, onSave: (newSettings: SimulationSettings) => void) {
    this.settings = {
      ...initialSettings,
      transientDuration: initialSettings.transientDuration ?? DEFAULT_TRANSIENT_DURATION_SECONDS,
      currentFlowMode: initialSettings.currentFlowMode ?? "conventional",
      currentAnimationSpeed: initialSettings.currentAnimationSpeed ?? 1.0,
      showCurrentAnimation: initialSettings.showCurrentAnimation ?? true,
      showThermalHeatmap: initialSettings.showThermalHeatmap ?? true,
      showReactiveFields: initialSettings.showReactiveFields ?? true,
      showTelemetryHud: initialSettings.showTelemetryHud ?? true,
    };
    this.onSaveCallback = onSave;

    this.settingsModal = document.querySelector("#settings-modal");
    this.settingsTriggerBtn = document.querySelector("#settings-trigger-btn");
    this.btnCancelSettings = document.querySelector("#btn-cancel-settings");
    this.btnSaveSettings = document.querySelector("#btn-save-settings");

    this.dtInput = document.querySelector("#settings-dt-input");
    this.transientDurationInput = document.querySelector("#settings-transient-duration-input");
    this.tolInput = document.querySelector("#settings-tol-input");
    this.iterInput = document.querySelector("#settings-iter-input");
    this.flowModeInput = document.querySelector("#settings-flow-mode-input");
    this.flowSpeedInput = document.querySelector("#settings-flow-speed-input");
    this.showCurrentAnimInput = document.querySelector("#settings-show-current-anim");
    this.showThermalHeatmapInput = document.querySelector("#settings-show-thermal-heatmap");
    this.showReactiveFieldsInput = document.querySelector("#settings-show-reactive-fields");
    this.showTelemetryHudInput = document.querySelector("#settings-show-telemetry-hud");
    this.appViewport = document.querySelector("#app-viewport");

    this.initEvents();
    window.addEventListener("astryd-settings-synchronized", (event) => {
      const next = (event as CustomEvent<SimulationSettings>).detail;
      if (
        next
        && Number.isFinite(next.dt) && next.dt > 0
        && Number.isFinite(next.tolerance) && next.tolerance > 0 && next.tolerance <= 1
        && Number.isInteger(next.maxIterations) && next.maxIterations >= 1 && next.maxIterations <= 10_000
      ) {
        this.settings = { ...next };
      }
    });
  }

  private initEvents() {
    if (this.settingsTriggerBtn && this.settingsModal) {
      this.settingsTriggerBtn.addEventListener("click", () => this.open());
    }

    if (this.btnCancelSettings && this.settingsModal) {
      this.btnCancelSettings.addEventListener("click", () => this.close());
    }

    if (this.btnSaveSettings && this.settingsModal) {
      this.btnSaveSettings.addEventListener("click", () => this.save());
    }

    this.settingsModal?.addEventListener("click", (event) => {
      if (event.target === this.settingsModal) this.close();
    });
    this.settingsModal?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key === "Tab") this.trapFocus(event);
    });
  }

  private open(): void {
    if (!this.settingsModal) return;
    if (this.dtInput) this.dtInput.value = this.settings.dt.toString();
    if (this.transientDurationInput) {
      this.transientDurationInput.value = (this.settings.transientDuration ?? DEFAULT_TRANSIENT_DURATION_SECONDS).toString();
    }
    if (this.tolInput) this.tolInput.value = this.settings.tolerance.toString();
    if (this.iterInput) this.iterInput.value = this.settings.maxIterations.toString();
    if (this.flowModeInput) this.flowModeInput.value = this.settings.currentFlowMode ?? "conventional";
    if (this.flowSpeedInput) this.flowSpeedInput.value = (this.settings.currentAnimationSpeed ?? 1.0).toString();
    if (this.showCurrentAnimInput) this.showCurrentAnimInput.checked = this.settings.showCurrentAnimation !== false;
    if (this.showThermalHeatmapInput) this.showThermalHeatmapInput.checked = this.settings.showThermalHeatmap !== false;
    if (this.showReactiveFieldsInput) this.showReactiveFieldsInput.checked = this.settings.showReactiveFields !== false;
    if (this.showTelemetryHudInput) this.showTelemetryHudInput.checked = this.settings.showTelemetryHud !== false;

    this.returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : this.settingsTriggerBtn;
    this.settingsModal.classList.add("open");
    this.settingsModal.setAttribute("aria-hidden", "false");
    if (this.appViewport) this.appViewport.inert = true;
    requestAnimationFrame(() => this.dtInput?.focus({ preventScroll: true }));
  }

  private close(): void {
    if (!this.settingsModal?.classList.contains("open")) return;
    this.settingsModal.classList.remove("open");
    this.settingsModal.setAttribute("aria-hidden", "true");
    if (this.appViewport) this.appViewport.inert = false;
    const focusTarget = this.returnFocus?.isConnected ? this.returnFocus : this.settingsTriggerBtn;
    this.returnFocus = null;
    requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
  }

  private save(): void {
    if (this.dtInput && this.transientDurationInput && this.tolInput && this.iterInput) {
      const dt = Number(this.dtInput.value);
      const transientDuration = Number(this.transientDurationInput.value);
      const tolerance = Number(this.tolInput.value);
      const maxIterations = Number(this.iterInput.value);

      this.dtInput.setCustomValidity(
        Number.isFinite(dt) && dt > 0
          ? ""
          : "El paso temporal debe ser un número mayor que cero.",
      );
      this.transientDurationInput.setCustomValidity(
        Number.isFinite(transientDuration) && transientDuration >= 0.001 && transientDuration <= 600
          ? ""
          : "La duración transitoria debe estar entre 0.001 y 600 segundos.",
      );
      this.tolInput.setCustomValidity(
        Number.isFinite(tolerance) && tolerance > 0 && tolerance <= 1
          ? ""
          : "La tolerancia debe ser mayor que cero y menor o igual que 1.",
      );
      this.iterInput.setCustomValidity(
        Number.isInteger(maxIterations) && maxIterations >= 1 && maxIterations <= 10_000
          ? ""
          : "Las iteraciones deben ser un entero entre 1 y 10 000.",
      );

      const invalidInput = [this.dtInput, this.transientDurationInput, this.tolInput, this.iterInput]
        .find(input => !input.checkValidity());
      if (invalidInput) {
        invalidInput.reportValidity();
        invalidInput.focus();
        return;
      }

      this.settings.dt = dt;
      this.settings.transientDuration = transientDuration;
      this.settings.tolerance = tolerance;
      this.settings.maxIterations = maxIterations;
      if (this.flowModeInput) {
        this.settings.currentFlowMode = this.flowModeInput.value === "electron" ? "electron" : "conventional";
      }
      if (this.flowSpeedInput) {
        const speed = parseFloat(this.flowSpeedInput.value);
        if (Number.isFinite(speed) && speed > 0) {
          this.settings.currentAnimationSpeed = speed;
        }
      }
      if (this.showCurrentAnimInput) {
        this.settings.showCurrentAnimation = this.showCurrentAnimInput.checked;
      }
      if (this.showThermalHeatmapInput) {
        this.settings.showThermalHeatmap = this.showThermalHeatmapInput.checked;
      }
      if (this.showReactiveFieldsInput) {
        this.settings.showReactiveFields = this.showReactiveFieldsInput.checked;
      }
      if (this.showTelemetryHudInput) {
        this.settings.showTelemetryHud = this.showTelemetryHudInput.checked;
      }
      this.onSaveCallback({ ...this.settings });
    }
    this.close();
  }

  private trapFocus(event: KeyboardEvent): void {
    if (!this.settingsModal) return;
    const focusable = [...this.settingsModal.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!this.settingsModal.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  public getSettings(): SimulationSettings {
    return this.settings;
  }
}
