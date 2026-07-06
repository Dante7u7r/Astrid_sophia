export interface SimulationSettings {
  dt: number;
  tolerance: number;
  maxIterations: number;
}

export class SettingsModal {
  private settingsModal: HTMLElement | null = null;
  private settingsTriggerBtn: HTMLButtonElement | null = null;
  private btnCancelSettings: HTMLButtonElement | null = null;
  private btnSaveSettings: HTMLButtonElement | null = null;

  private dtInput: HTMLInputElement | null = null;
  private tolInput: HTMLInputElement | null = null;
  private iterInput: HTMLInputElement | null = null;
  private appViewport: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;

  private settings: SimulationSettings;
  private onSaveCallback: (newSettings: SimulationSettings) => void;

  constructor(initialSettings: SimulationSettings, onSave: (newSettings: SimulationSettings) => void) {
    this.settings = { ...initialSettings };
    this.onSaveCallback = onSave;

    this.settingsModal = document.querySelector("#settings-modal");
    this.settingsTriggerBtn = document.querySelector("#settings-trigger-btn");
    this.btnCancelSettings = document.querySelector("#btn-cancel-settings");
    this.btnSaveSettings = document.querySelector("#btn-save-settings");

    this.dtInput = document.querySelector("#settings-dt-input");
    this.tolInput = document.querySelector("#settings-tol-input");
    this.iterInput = document.querySelector("#settings-iter-input");
    this.appViewport = document.querySelector("#app-viewport");

    this.initEvents();
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
    if (this.tolInput) this.tolInput.value = this.settings.tolerance.toString();
    if (this.iterInput) this.iterInput.value = this.settings.maxIterations.toString();

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
    if (this.dtInput && this.tolInput && this.iterInput) {
      this.settings.dt = parseFloat(this.dtInput.value) || 0.0001;
      this.settings.tolerance = parseFloat(this.tolInput.value) || 0.00001;
      this.settings.maxIterations = parseInt(this.iterInput.value) || 100;
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
